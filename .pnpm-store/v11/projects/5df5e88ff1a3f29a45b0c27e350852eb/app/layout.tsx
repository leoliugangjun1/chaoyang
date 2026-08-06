import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "视觉策略 AI 工作台",
  description: "上传产品资料与规则文件，生成结构化视觉策略。"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
