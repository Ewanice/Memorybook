export const backgroundStyles = [
  { id: "solid", name: "纯色", color: "#f7f5ef" },
  { id: "fiber", name: "棉纸", color: "#f4f0e6" },
  { id: "rice", name: "云絮宣纸", color: "#f5f2e9" },
  { id: "kraft", name: "暖调牛皮纸", color: "#d7b991" },
  { id: "linen", name: "亚麻织纹", color: "#eee9df" },
  { id: "grid", name: "手帐方格", color: "#f5f4ed" },
  { id: "dots", name: "点阵笔记", color: "#f5f1e9" },
  { id: "wash", name: "水彩晨雾", color: "#edf1ed" },
] as const;
export type BackgroundStyle = (typeof backgroundStyles)[number]["id"];
