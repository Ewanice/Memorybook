import { createRoot } from "react-dom/client";
import { App } from "./App";
const root = document.getElementById("root");
if (!root) throw new Error("应用入口不存在。");
createRoot(root).render(<App />);
