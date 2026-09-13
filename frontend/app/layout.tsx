import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SupplyRestore Control Room",
  description: "Verification-first autonomous supply-chain recovery",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
