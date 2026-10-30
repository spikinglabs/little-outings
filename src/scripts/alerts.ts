// Shows the city alerts (components/CityAlerts.astro) for a town and hides those already over: the page is
// built nightly, so an alert for Saturday is still in Sunday morning's page.
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(new Date());

/** Shows `town`'s alerts that are not over; `near` adds other towns (an alert in Köln matters in Hürth). */
export function showAlerts(town?: string, near: (city: string) => boolean = () => false): void {
  const box = document.querySelector<HTMLElement>("[data-alerts]");
  if (!box) return;
  const day = today();
  let any = false;
  box.querySelectorAll<HTMLElement>("[data-alert-city]").forEach((li) => {
    const city = li.dataset.alertCity!;
    const on = (!town || city === town || near(city)) && li.dataset.alertEnd! >= day;
    li.hidden = !on;
    any ||= on;
  });
  box.hidden = !any;
}
