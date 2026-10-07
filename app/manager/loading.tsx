import { DataTable, TableRowSkeleton } from "@/components/manager/DataRow";

// Shown instantly while a /manager page's server data loads, so a click in
// the sidebar responds right away instead of feeling frozen. Matches the real
// pages' section/table rhythm so the swap-in doesn't jump.
export default function Loading() {
  return (
    <section className="sec">
      <DataTable>
        <TableRowSkeleton count={8} />
      </DataTable>
    </section>
  );
}
