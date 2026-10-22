import type { Metadata } from "next";

import { AnnexureWorkbench } from "@/components/annexure/annexure-workbench";

export const metadata: Metadata = {
  title: "Annexure Sanitizer",
  description:
    "Sanitize RRA VAT sales, purchases, imports and WHT annexures and export a headerless tab-delimited .txt.",
};

export default function AnnexurePage() {
  return <AnnexureWorkbench />;
}
