using System;
using System.IO;
using System.Linq;
using System.Diagnostics;
using System.Threading;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;
using System.Windows.Forms;

// Stable bootstrap outside Electron: recovery works even if Electron/ASAR replacement was interrupted.
internal static class MemorybookLauncher {
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 8 * 1024 * 1024 };
    static string Root, Work, Active;
    static bool Cancelled;
    static Form Form;
    static Label Label;
    static ProgressBar Progress;
    static Button Cancel;
    static bool Updating;
    static bool Quiet;
    static string CancelFile;
    static string Full(string name) {
        if (String.IsNullOrEmpty(name) || name.Length > 220 || name.Contains("\\") || name.Contains(":") || name.Any(c => !(Char.IsLetterOrDigit(c) && c < 128 || "_. /-".Contains(c)))) throw new Exception("Invalid program path");
        var parts = name.Split('/');
        if (parts.Any(p => p.Length == 0 || p == "." || p == ".." || p.EndsWith(".") || p.EndsWith(" "))) throw new Exception("Invalid program path");
        if(parts.Any(p=>System.Text.RegularExpressions.Regex.IsMatch(p,@"^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)",System.Text.RegularExpressions.RegexOptions.IgnoreCase)))throw new Exception("Reserved Windows file name");
        string first=parts[0].ToLowerInvariant();
        if(new[]{"data",".updates",".git",".local","phrases.txt","update-source.json"}.Contains(first) || name.StartsWith("materials/imported-fonts/",StringComparison.OrdinalIgnoreCase)) throw new Exception("Personal data cannot be updated");
        string path=Root;
        foreach(string part in parts){path=Path.Combine(path,part);if((File.Exists(path)||Directory.Exists(path))&&(File.GetAttributes(path)&FileAttributes.ReparsePoint)!=0)throw new Exception("Linked update path rejected");}
        return path;
    }
    static void Tick(string message, bool cancellable=true) { if(CancelFile!=null&&File.Exists(CancelFile))Cancelled=true;if(Form!=null){Label.Text=message;Application.DoEvents();}if(cancellable&&Cancelled)throw new OperationCanceledException(); }
    static string Hash(string path, bool cancellable=true) {
        using(var input=File.OpenRead(path))using(var sha=SHA256.Create()) {
            byte[] buffer=new byte[1024*1024];int count;
            while((count=input.Read(buffer,0,buffer.Length))>0){sha.TransformBlock(buffer,0,count,null,0);Tick(Label==null?"":Label.Text,cancellable);}
            sha.TransformFinalBlock(new byte[0],0,0);return BitConverter.ToString(sha.Hash).Replace("-","").ToLowerInvariant();
        }
    }
    static void Write(string path,object value){string temp=path+".next";using(var file=new FileStream(temp,FileMode.Create,FileAccess.Write,FileShare.None)){byte[] bytes=Encoding.UTF8.GetBytes(Json.Serialize(value));file.Write(bytes,0,bytes.Length);file.Flush(true);}if(File.Exists(path))File.Replace(temp,path,null);else File.Move(temp,path);}
    static Dictionary<string,object> Read(string path){return Json.Deserialize<Dictionary<string,object>>(File.ReadAllText(path,Encoding.UTF8));}
    static string Text(Dictionary<string,object> map,string key){return Convert.ToString(map[key]);}
    static IEnumerable<Dictionary<string,object>> Files(Dictionary<string,object> plan){return ((System.Collections.IEnumerable)plan["files"]).Cast<Dictionary<string,object>>();}
    static string Quote(string value) {return "\""+System.Text.RegularExpressions.Regex.Replace(value,"(\\\\*)\"","$1$1\\\"")+new string('\\',value.Reverse().TakeWhile(c=>c=='\\').Count())+"\"";}
    static Process Start(string[] arguments){return Process.Start(new ProcessStartInfo(Path.Combine(Root,"Memorybook.App.exe"),String.Join(" ",arguments.Select(Quote).ToArray())){UseShellExecute=false,WorkingDirectory=Root});}
    static bool Alive(int pid){try{return !Process.GetProcessById(pid).HasExited;}catch(ArgumentException){return false;}}
    static void KillOwn(int pid){if(!Alive(pid))return;using(var p=Process.GetProcessById(pid)){if(String.Equals(p.MainModule.FileName,Path.Combine(Root,"Memorybook.App.exe"),StringComparison.OrdinalIgnoreCase)){p.Kill();p.WaitForExit(10000);}}}
    static void Validate(Dictionary<string,object> plan,string transaction){
        if(Text(plan,"id")!=transaction || !System.Text.RegularExpressions.Regex.IsMatch(transaction,"^[a-f0-9]{32}$") || Path.GetFullPath(Text(plan,"root")).TrimEnd('\\')!=Root.TrimEnd('\\')) throw new Exception("Update transaction does not match installation");
        var seen=new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach(var f in Files(plan)){string name=Text(f,"path");Full(name);if(!seen.Add(name))throw new Exception("Duplicate update path");if(!System.Text.RegularExpressions.Regex.IsMatch(Text(f,"oldSha256"),"^([a-f0-9]{64})?$") || !System.Text.RegularExpressions.Regex.IsMatch(Text(f,"sha256"),"^([a-f0-9]{64})?$"))throw new Exception("Invalid file digest");}
    }
    static void Retry(Action action,bool cancellable){var until=DateTime.UtcNow.AddSeconds(10);for(;;){try{action();return;}catch(IOException){if(DateTime.UtcNow>=until)throw;Tick("正在等待程序文件解除占用…",cancellable);Thread.Sleep(100);}}}
    static void CopyProgram(string source,string target){using(var input=File.OpenRead(source))using(var output=new FileStream(target,FileMode.Create,FileAccess.Write,FileShare.None)){byte[] buffer=new byte[1024*1024];int count;while((count=input.Read(buffer,0,buffer.Length))>0){output.Write(buffer,0,count);Tick("正在写入新版程序，可取消并恢复原版本…");}output.Flush(true);}}
    static void Cleanup(Dictionary<string,object> plan,string tx) {try{foreach(var f in Files(plan)){string stage=Path.Combine(tx,"stage",Text(f,"path").Replace('/',Path.DirectorySeparatorChar));if(File.Exists(stage))File.Delete(stage);}foreach(string key in new[]{"full","previous"}){string payload=Path.Combine(tx,key+".bin");if(File.Exists(payload))File.Delete(payload);}}catch(IOException cleanup){File.WriteAllText(Path.Combine(tx,"cleanup-warning.txt"),cleanup.Message);}}
    static void Rollback(Dictionary<string,object> plan,string tx) {
        Tick("正在恢复原版本，请勿关闭窗口…",false);
        foreach(var f in Files(plan).Reverse()){
            string name=Text(f,"path"),target=Full(name),backup=Path.Combine(tx,"backup",name.Replace('/',Path.DirectorySeparatorChar));
            if(File.Exists(backup)){
                if(Hash(backup,false)!=Text(f,"oldSha256"))throw new Exception("Original program backup is damaged: "+name);
                if(File.Exists(target))Retry(()=>File.Delete(target),false);Directory.CreateDirectory(Path.GetDirectoryName(target));Retry(()=>File.Move(backup,target),false);
            } else if(!Convert.ToBoolean(f["existed"])&&File.Exists(target)) {
                if(Hash(target,false)!=Text(f,"sha256"))throw new Exception("A new program file changed during recovery: "+name);
                File.Delete(target);
            }
            string next=target+".update-next";if(File.Exists(next))File.Delete(next);
        }
        Write(Path.Combine(tx,"result.json"),new{status="rolled-back"});File.Delete(Active);Cleanup(plan,tx);
    }
    static FileStream Lock(){Directory.CreateDirectory(Work);return new FileStream(Path.Combine(Work,"transaction.lock"),FileMode.OpenOrCreate,FileAccess.ReadWrite,FileShare.None);}
    static void Recover(){
        if(!File.Exists(Active))return;
        using(var gate=Lock()){
            var active=Read(Active);string id=Text(active,"id"),tx=Path.Combine(Work,id);var plan=Read(Path.Combine(tx,"plan.json"));Validate(plan,id);
            if(File.Exists(Path.Combine(tx,"committed.json"))){File.Delete(Active);return;}
            Rollback(plan,tx);
            if(!Quiet)MessageBox.Show("上次更新中断，已恢复原程序。工程、照片与设置没有被替换。","Memorybook",MessageBoxButtons.OK,MessageBoxIcon.Information);
        }
    }
    static void CreateForm(){
        Form=new Form{Font=new System.Drawing.Font("Microsoft YaHei UI",9),BackColor=System.Drawing.Color.FromArgb(244,243,239),Text="Memorybook 更新",Width=490,Height=205,StartPosition=FormStartPosition.CenterScreen,FormBorderStyle=FormBorderStyle.FixedDialog,MaximizeBox=false,MinimizeBox=true};
        Label=new Label{Left=24,Top=22,Width=430,Height=47,Text="正在准备更新…"};Progress=new ProgressBar{Left=24,Top=80,Width=425,Height=15};Cancel=new Button{Left=335,Top=111,Width=115,Height=30,Text="取消更新"};Cancel.Click+=(s,e)=>{Cancelled=true;Cancel.Enabled=false;};
        Form.FormClosing+=(s,e)=>{if(Updating){Cancelled=true;Cancel.Enabled=false;e.Cancel=true;}};
        Form.Controls.Add(Label);Form.Controls.Add(Progress);Form.Controls.Add(Cancel);Form.Show();Application.DoEvents();
    }
    static int Apply(string id){
        string tx=Path.Combine(Work,id);var plan=Read(Path.Combine(tx,"plan.json"));Validate(plan,id);if(!Quiet)CreateForm();CancelFile=Path.Combine(tx,"cancel");Updating=true;
        Process launched=null;
        using(var gate=Lock()){
            if(File.Exists(Active))throw new Exception("An update is already pending; recover it before retrying");
            Write(Active,new{id=id});Write(Path.Combine(tx,"helper-ready.json"),new{pid=Process.GetCurrentProcess().Id});
            try{
                Tick("正在等待软件保存并关闭…");var until=DateTime.UtcNow.AddSeconds(60);
                var wait=((System.Collections.IEnumerable)plan["waitPids"]).Cast<object>().Select(Convert.ToInt32).ToArray();
                while(wait.Any(Alive)){Tick("正在等待软件保存并关闭…");if(DateTime.UtcNow>until)throw new Exception("软件尚未关闭，更新已停止。");Thread.Sleep(100);}
                var files=Files(plan).ToArray();if(Progress!=null)Progress.Maximum=Math.Max(1,files.Length);
                foreach(var f in files){Tick("正在校验："+Text(f,"path"));string name=Text(f,"path"),target=Full(name),stage=Path.Combine(tx,"stage",name.Replace('/',Path.DirectorySeparatorChar));
                    if(File.Exists(target)!=Convert.ToBoolean(f["existed"]) || (File.Exists(target)&&Hash(target)!=Text(f,"oldSha256")))throw new Exception("程序在准备更新后发生变化，请重新检查更新："+name);
                    if(!String.IsNullOrEmpty(Text(f,"sha256"))&&Hash(stage)!=Text(f,"sha256"))throw new Exception("待更新文件校验失败："+name);
                }
                foreach(var f in files){string name=Text(f,"path");Tick("正在替换："+name);string target=Full(name),backup=Path.Combine(tx,"backup",name.Replace('/',Path.DirectorySeparatorChar));Directory.CreateDirectory(Path.GetDirectoryName(target));Directory.CreateDirectory(Path.GetDirectoryName(backup));
                    if(File.Exists(target))Retry(()=>File.Move(target,backup),true);
                    if(!String.IsNullOrEmpty(Text(f,"sha256"))){string stage=Path.Combine(tx,"stage",name.Replace('/',Path.DirectorySeparatorChar));CopyProgram(stage,target+".update-next");Retry(()=>File.Move(target+".update-next",target),true);if(Hash(target)!=Text(f,"sha256"))throw new Exception("新版文件写入校验失败："+name);}
                    if(Progress!=null)Progress.Value=Math.Min(Progress.Maximum,Progress.Value+1);
                }
                Tick("正在验证新版启动…");string[] restart=((System.Collections.IEnumerable)plan["arguments"]).Cast<string>().ToArray();launched=Start(restart.Concat(new[]{"--update-health="+id}).ToArray());
                until=DateTime.UtcNow.AddSeconds(45);string ready=Path.Combine(tx,"health-ready.json");
                while(!File.Exists(ready)){Tick("正在验证新版启动，可取消并恢复原版本…");if(launched.HasExited||DateTime.UtcNow>until)throw new Exception("新版启动未通过验证，已准备恢复原版本。");Thread.Sleep(100);}
                var health=Read(ready);if(Text(health,"id")!=id||Text(health,"version")!=Text(plan,"version"))throw new Exception("新版版本验证不匹配。");
                Write(Path.Combine(tx,"committed.json"),new{version=Text(plan,"version")});File.Delete(Active);
                Cleanup(plan,tx);
                if(Cancel!=null)Cancel.Enabled=false;Tick("更新完成，软件已重新打开。",false);Updating=false;if(Form!=null)Form.Close();return 0;
            } catch(Exception error){
                Write(Path.Combine(tx,"failure.json"),new{message=error.Message,cancelled=error is OperationCanceledException});
                if(launched!=null&&!launched.HasExited){KillOwn(launched.Id);}
                Rollback(plan,tx);
                bool oldAlive=((System.Collections.IEnumerable)plan["waitPids"]).Cast<object>().Select(Convert.ToInt32).Any(Alive);
                if(!oldAlive)Start(((System.Collections.IEnumerable)plan["arguments"]).Cast<string>().ToArray());
                Updating=false;if(Form!=null)Form.Close();if(!Quiet&&!(error is OperationCanceledException))MessageBox.Show(error.Message+"\n已恢复原程序，个人资料未被替换。","更新未完成",MessageBoxButtons.OK,MessageBoxIcon.Warning);return 2;
            }
        }
    }
    [STAThread] static int Main(string[] args){
        Application.EnableVisualStyles();Quiet=args.Contains("--headless");
        try{
            string apply=args.FirstOrDefault(a=>a.StartsWith("--apply-update="));
            Root=Path.GetFullPath(apply==null?AppDomain.CurrentDomain.BaseDirectory:args.First(a=>a.StartsWith("--root=")).Substring(7)).TrimEnd('\\');Work=Path.Combine(Root,".updates");Active=Path.Combine(Work,"active.json");
            if((File.GetAttributes(Root)&FileAttributes.ReparsePoint)!=0 || (Directory.Exists(Work)&&(File.GetAttributes(Work)&FileAttributes.ReparsePoint)!=0))throw new Exception("更新目录不能使用链接。");
            if(apply!=null)return Apply(apply.Substring(15));
            string health=args.FirstOrDefault(a=>a.StartsWith("--update-health="));
            if(health==null)Recover();
            using(var process=Start(args.Concat(new[]{"--launcher-pid="+Process.GetCurrentProcess().Id}).ToArray())){Directory.CreateDirectory(Work);string marker=Path.Combine(Work,"launcher-"+Process.GetCurrentProcess().Id+".pid");File.WriteAllText(marker,process.Id.ToString());try{process.WaitForExit();return process.ExitCode;}finally{File.Delete(marker);}}
        }catch(IOException error){if(Quiet&&Work!=null){Directory.CreateDirectory(Work);File.WriteAllText(Path.Combine(Work,"bootstrap-error.txt"),error.ToString());}if(!Quiet)MessageBox.Show("程序正在更新或文件被占用，请等待更新结束后再打开。\n"+error.Message,"Memorybook",MessageBoxButtons.OK,MessageBoxIcon.Information);return 1;}
        catch(Exception error){if(Quiet&&Work!=null){Directory.CreateDirectory(Work);File.WriteAllText(Path.Combine(Work,"bootstrap-error.txt"),error.ToString());}Updating=false;if(Form!=null)Form.Close();if(!Quiet)MessageBox.Show(error.Message,"Memorybook 无法启动",MessageBoxButtons.OK,MessageBoxIcon.Error);return 1;}
    }
}
