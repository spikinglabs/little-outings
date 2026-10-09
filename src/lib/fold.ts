/** Lower-case, German umlauts spelled out and other accents dropped, so "dueren" finds "Düren". */
export function fold(text: string | null | undefined): string {
  return String(text ?? "").toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .normalize("NFD").replace(/[̀-ͯ]/g, "");
}
