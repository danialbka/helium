// Small adapter around the official extension's tab API and native Page.goto.
// Attach on about:blank before navigation so Runtime contexts aren't missed.
export function backgroundTabCode(url) {
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error('Background tabs require an absolute HTTP(S) URL.'); }
  if (!['http:', 'https:'].includes(parsed.protocol))
    throw new Error('Background tabs support HTTP(S) websites only. Internal/about/data URLs are not supported by this extension path.');
  return `async page => {
    const context = page.context();
    const helper = context.pages().find(p => p.url().startsWith('chrome-extension://mmlmfjhmonkocbjadbfplnigmagldckm/connect.html'));
    if (!helper) throw Error('The official extension helper is missing. Reconnect Helium first.');
    const blank = 'about:blank#helium-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
    const created = await helper.evaluate(async blank => {
      const current = await chrome.tabs.getCurrent();
      if (current.groupId < 0) throw Error('The extension helper must be in its Playwright tab group.');
      const before = (await chrome.tabs.query({windowId: current.windowId, active: true}))[0]?.id;
      const tab = await chrome.tabs.create({windowId: current.windowId, active: false, url: blank});
      try { await chrome.tabs.group({tabIds: [tab.id], groupId: current.groupId}); }
      catch (error) {
        const failed = await chrome.tabs.get(tab.id).catch(() => null);
        if (failed && !failed.active) await chrome.tabs.remove(tab.id).catch(() => {});
        throw error;
      }
      return {id: tab.id, before, windowId: current.windowId};
    }, blank);
    try {
    // The event may already have arrived. Lookup and listener registration have
    // no await between them, so no event can slip through this boundary.
    const target = context.pages().find(p => p.url() === blank) ||
      await context.waitForEvent('page', {predicate: p => p.url() === blank, timeout: 10000});
    await target.goto(${JSON.stringify(url)}, {waitUntil: 'domcontentloaded', timeout: 60000});
    const after = await helper.evaluate(async windowId => (await chrome.tabs.query({windowId, active: true}))[0]?.id, created.windowId);
    return {tabId: created.id, index: context.pages().indexOf(target), url: target.url(), title: await target.title(), selectedTabUnchanged: created.before === after};
    } catch (error) {
      await helper.evaluate(async id => {
        const tab = await chrome.tabs.get(id).catch(() => null);
        if (tab && !tab.active) await chrome.tabs.remove(id);
      }, created.id).catch(() => {});
      throw error;
    }
  }`;
}
