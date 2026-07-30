import { requireUser } from '@/lib/auth';
import { AppShell } from '@/components/AppShell';
import { getPresentationContext } from '@/lib/presentation/context';
import { presentationKillSwitchEnabled } from '@/lib/presentation/core';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  const presentation = await getPresentationContext();
  // Whether the OWNER may enter the mode from the menu (feature enabled + not
  // already active). Purely drives whether the enable control is offered.
  const presentationAvailable = presentationKillSwitchEnabled() && !presentation.active;
  return (
    <AppShell
      user={user}
      presentation={presentation}
      presentationAvailable={presentationAvailable}
    >
      {children}
    </AppShell>
  );
}
