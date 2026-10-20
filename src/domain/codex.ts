export type CodexPreferences = {
  executable: string;
  model: string;
  prompt: string;
  skillPaths: string[];
};
export const defaultCodexPreferences: CodexPreferences = {
  executable: "",
  model: "",
  skillPaths: [],
  prompt:
    "你是一位纪念册设计师。以照片为主，使用清晰的视觉层级、统一边距与恰当留白。合理安排照片、短语与透明贴纸，避免文字或主体被遮挡。照片按给定顺序叙事，每张恰好使用一次。优先轮用不同固定排版，避免连续重复；自由设计模式下可根据照片比例安排版面。使用提供的短语，不引用未提供的歌词或杜撰用户经历。选用 skill 时借鉴视觉原则。所有文字与图片必须保留为可编辑元素。只返回符合给定协议的 JSON，不返回代码、Markdown 或解释。",
};
