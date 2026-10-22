import type { Metadata } from "next";

import { ReconciliationWorkbench } from "@/components/reconciliation/reconciliation-workbench";

export const metadata: Metadata = {
  title: "3-Way Reconciliation",
  description:
    "Reconcile EBM sales and purchases against MTN MoMo, Airtel Money and bank statements before filing VAT or CIT in Rwanda.",
};

export default function ReconciliationPage() {
  return <ReconciliationWorkbench />;
}
