import type { Metadata } from "next";

import { Sidebar, MobileNav } from "@/components/layout/sidebar";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "TaxOps Rwanda — RRA pre-declaration workspace",
    template: "%s · TaxOps Rwanda",
  },
  description:
    "Multi-tenant tax advisory workspace for Rwandan accounting firms: RRA annexure sanitizer, EBM vs MoMo/bank reconciliation, and client workflow automation.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background">
        <div className="flex min-h-screen">
          <Sidebar />
          <div className="flex min-w-0 flex-1 flex-col">
            <MobileNav />
            <main className="flex-1 px-4 pb-16 pt-6 sm:px-6 lg:px-8 lg:pt-8">{children}</main>
            <footer className="border-t bg-white px-6 py-4 text-xs text-muted-foreground">
              <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-2">
                <span>
                  TaxOps Rwanda · Pre-declaration data pipeline · Not affiliated with RRA
                </span>
                <span className="tabular-nums">
                  VAT / WHT / PAYE due 15th · CIT / PIT due 31 March
                </span>
              </div>
            </footer>
          </div>
        </div>
      </body>
    </html>
  );
}
