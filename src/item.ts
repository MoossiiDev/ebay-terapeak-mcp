/**
 * Item-page parser: pulls the fields a pricing decision needs out of an eBay item
 * page (live or ended) and its seller-description iframe.
 */
import { EbaySession } from './browser.js';

export interface ItemDetail {
  itemId: string;
  title: string | null;
  status: string | null;
  price: string | null;
  condition: string | null;
  summary: string | null;
  description: string | null;
  url: string;
}

function meta(html: string, prop: string): string | null {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']*)["']`,
    'i',
  );
  const m = html.match(re);
  return m ? decode(m[1]) : null;
}

function decode(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

export function htmlToText(html: string): string {
  return decode(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr)>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

function firstText(html: string, re: RegExp): string | null {
  const m = html.match(re);
  return m ? htmlToText(m[1]).slice(0, 200) || null : null;
}

export async function getItem(
  itemId: string,
  session: EbaySession,
  maxChars = 4000,
): Promise<ItemDetail> {
  const { html, descHtml } = await session.fetchItem(itemId);
  const desc = descHtml ? htmlToText(descHtml) : null;
  return {
    itemId,
    title: meta(html, 'og:title')?.replace(/ \| eBay$/, '') ?? null,
    status:
      firstText(
        html,
        /<div[^>]+class="[^"]*ux-layout-section__textual-display--statusMessage[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
      ) ??
      /This listing (?:was ended|sold|ended)/i.exec(html)?.[0] ??
      null,
    price: /x-price-primary[\s\S]{0,400}?((?:US |C |AU )?\$[\d,.]+)/.exec(html)?.[1] ?? null,
    condition: /condition"?>(?:<!--[^>]*-->)*([^<]{2,60})<!--/.exec(html)?.[1]?.trim() ?? null,
    summary: meta(html, 'og:description'),
    description: desc ? desc.slice(0, maxChars) : null,
    url: `https://www.ebay.com/itm/${itemId}`,
  };
}
