import Nav from "@/components/Nav";
import BottomNav from "@/components/BottomNav";
import PendingNotice from "@/components/PendingNotice";
import { ProfileProvider } from "@/components/ProfileContext";
import { loadLocations, requireProfile } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireProfile();
  if (!profile || profile.role === "pending") return <PendingNotice email={profile?.email ?? ""} />;
  const locations = await loadLocations();
  return (
    <ProfileProvider profile={profile} locations={locations}>
      <Nav />
      <main className="mx-auto max-w-6xl px-4 pb-24 pt-6 lg:pb-6">{children}</main>
      <BottomNav />
    </ProfileProvider>
  );
}
