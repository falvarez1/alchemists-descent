// The Duel select screen for probes (ui/VersusLobby): every choice is a ◀ value ▶ cycler, a focusable
// role="group" named like "Player 1 device" with its value in data-value and the choices it can take in
// data-options. These step it with REAL clicks on its arrows until it shows the wanted value.

/** The value a cycler shows ("keyboard", "cpu", "pad:0", a fighter id, a CPU level "1".."5"). */
export async function cyclerValue(page, name) {
  return page.getByRole('group', { name, exact: true }).getAttribute('data-value');
}

/**
 * Click a cycler's ▶ (or ◀ with `back: true`) until it reads `value`. Throws when the value never comes round
 * (an option the seat may not take, e.g. a device the other seat holds).
 */
export async function cycleTo(page, name, value, { back = false, max = 14 } = {}) {
  const group = page.getByRole('group', { name, exact: true });
  for (let i = 0; i <= max; i++) {
    if (await group.getAttribute('data-value') === value) return;
    const arrow = group.locator(back ? '.versus-arrow-prev' : '.versus-arrow-next');
    const box = await arrow.boundingBox();
    if (!box) throw new Error(`${name}: no arrow to click`);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(40);
  }
  throw new Error(`${name} never showed ${value} (it shows ${await group.getAttribute('data-value')})`);
}
