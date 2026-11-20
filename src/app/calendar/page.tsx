import CalendarExplorer from "@/components/CalendarExplorer";
import { getCalendarData } from "@/lib/calendar-data";
import { parseCalendarMonth } from "@/lib/calendar-model";

export const dynamic = "force-dynamic";

export default async function CalendarPage() {
  const { year, month } = parseCalendarMonth(null, null);
  const data = await getCalendarData(year, month);
  return <CalendarExplorer initial={data} />;
}
