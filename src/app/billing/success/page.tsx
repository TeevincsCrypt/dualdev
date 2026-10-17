import { BillingSuccess } from "@/components/BillingSuccess";

export default async function Page({ searchParams }: { searchParams: Promise<{ session_id?: string }> }) {
  const { session_id } = await searchParams;
  return <BillingSuccess sessionId={session_id ?? ""} />;
}
