import React from "react";
import "./globals.css";

export const metadata = {
  title: "SAM7 AI • Academic Document Assistant",
  description: "ChatGPT-style document and subtopic assistant for Semester 7 course materials",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🥝</text></svg>" />
      </head>
      <body>{children}</body>
    </html>
  );
}
