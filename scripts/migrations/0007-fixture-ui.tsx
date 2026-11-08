// Harness only: real UI components, fixture-only HTTP backend and Link seam.
import { createRoot } from 'react-dom/client';
import UpdatesProvider from '../../src/components/UpdatesProvider';
import NotificationBell from '../../src/components/NotificationBell';
import NotificationsPage from '../../src/components/NotificationsPage';
import FollowButton from '../../src/components/FollowButton';
const fixture=(globalThis as unknown as {fixture:{mediaId:number;episodeId:number;title:string}}).fixture;
createRoot(document.getElementById('root')!).render(<UpdatesProvider>
  <h1>{fixture.title}</h1><FollowButton mediaId={fixture.mediaId} mediaType="anime" />
  <NotificationBell /><NotificationsPage /><section id={`episode-${fixture.episodeId}`}>Fixture episode detail destination</section>
</UpdatesProvider>);
