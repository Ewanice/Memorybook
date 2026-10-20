import { BrowserWindow } from "electron";
import type { Album } from "../domain/model";
import { DomainError } from "../domain/model";
export async function validateFontForRendering(
  bytes: Uint8Array,
): Promise<void> {
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await window.loadURL("memory://app/export.html");
    const valid = await Promise.race([
      window.webContents.executeJavaScript(
        `new FontFace('ImportProbe',Uint8Array.from(atob(${JSON.stringify(Buffer.from(bytes).toString("base64"))}),c=>c.charCodeAt(0)).buffer).load().then(()=>true,()=>false)`,
      ),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new DomainError("字体读取超时，请更换字体后重试。")),
          30000,
        );
      }),
    ]);
    if (!valid)
      throw new DomainError(
        "字体字形数据无法读取，请选择有效的 TTF 或 OTF 字体。",
      );
  } finally {
    if (timer) clearTimeout(timer);
    window.destroy();
  }
}
export async function validateAiLayout(
  before: Album,
  after: Album,
  message = "AI 方案导致文字溢出，整批未应用。请补充批注或手动调整。",
): Promise<void> {
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  try {
    await window.loadURL("memory://app/export.html");
    const overflow = await window.webContents.executeJavaScript(
      `window.memorybookExport.preflight(${JSON.stringify(before)},${JSON.stringify(after)})`,
    );
    if (overflow) throw new DomainError(message);
  } finally {
    window.destroy();
  }
}
