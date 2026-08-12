import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "IPD 产品视觉准入审核",
  description: "本地产品资料准入审核工具",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
