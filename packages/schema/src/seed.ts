import type { AccountId } from "./entities.ts";

/**
 * Default data created on a fresh database. Everything here is editable in the app;
 * forks change it in Settings, not in code.
 */

export const SEED_ACCOUNTS = [
  { id: "sadapay", name: "SadaPay", role: "vault" },
  { id: "nayapay", name: "NayaPay", role: "pocket" },
] as const;

type SeedCategory = {
  id: string;
  parent_id: string | null;
  name: string;
  icon: string;
  wallet_hint: AccountId | null;
  nature: "fixed" | "variable";
  hidden?: boolean;
};

const top = (
  id: string,
  name: string,
  icon: string,
  wallet_hint: AccountId | null,
  nature: "fixed" | "variable",
  hidden = false,
): SeedCategory => ({ id, parent_id: null, name, icon, wallet_hint, nature, hidden });
const sub = (parent: SeedCategory, id: string, name: string, hidden = false): SeedCategory => ({
  ...parent,
  id: `${parent.id}.${id}`,
  parent_id: parent.id,
  name,
  hidden: parent.hidden || hidden,
});

const car = top("car", "Car", "car", "nayapay", "variable");
const food = top("food", "Food", "utensils", "nayapay", "variable");
const enjoy = top("enjoyments", "Enjoyments", "party-popper", "nayapay", "variable");
const self = top("self", "Self", "user", "nayapay", "variable");
const bills = top("bills", "Bills", "receipt", "sadapay", "fixed");
const subs = top("subscriptions", "Subscriptions", "repeat", "sadapay", "fixed");
const charity = top("charity", "Charity", "heart-handshake", "sadapay", "variable");
const misc = top("misc", "Miscellaneous", "coins", "nayapay", "variable");
const health = top("health", "Health", "stethoscope", null, "variable", true);
const gifts = top("gifts", "Gifts", "gift", null, "variable", true);
const fees = top("fees", "Fees & charges", "landmark", null, "variable", true);

export const SEED_CATEGORIES: SeedCategory[] = [
  car,
  sub(car, "petrol", "Petrol"),
  sub(car, "carwash", "Car wash"),
  sub(car, "maintenance", "Maintenance", true),
  sub(car, "parking", "Parking & tolls", true),
  food,
  sub(food, "friends", "Friends"),
  sub(food, "family", "Family"),
  sub(food, "solo", "Solo", true),
  enjoy,
  sub(enjoy, "friends", "Friends"),
  sub(enjoy, "family", "Family"),
  self,
  sub(self, "routine", "Routine"),
  sub(self, "indulgences", "Indulgences"),
  bills,
  sub(bills, "electricity", "Electricity"),
  sub(bills, "guard", "Guard"),
  sub(bills, "phone", "Phone"),
  sub(bills, "pocketmoney", "Brother's pocket money"),
  subs,
  // Kinds of subscription, not services: the services themselves are the subscriptions you add (Plan → Fixed).
  sub(subs, "enjoyment", "Enjoyment"),
  sub(subs, "professional", "Professional"),
  sub(subs, "essentials", "Essentials"),
  charity,
  misc,
  health,
  sub(health, "doctor", "Doctor"),
  sub(health, "pharmacy", "Pharmacy"),
  gifts,
  sub(gifts, "friends", "Friends"),
  sub(gifts, "family", "Family"),
  fees,
];

/** Starter rules: case-insensitive regex over `${description} ${reason}`. */
export const SEED_RULES: { pattern: string; category_id: string | null; flow: string | null }[] = [
  {
    pattern: "\\b(petrol|fuel|pso|shell|total ?parco|attock|go petroleum)\\b",
    category_id: "car.petrol",
    flow: null,
  },
  { pattern: "\\bcar ?wash\\b", category_id: "car.carwash", flow: null },
  {
    pattern: "\\b(k-?electric|kelectric|lesco|iesco|electricity|bijli)\\b",
    category_id: "bills.electricity",
    flow: null,
  },
  { pattern: "\\bguard\\b", category_id: "bills.guard", flow: null },
  {
    pattern: "\\b(jazz|zong|telenor|ufone|onic|mobile (load|package)|top ?up)\\b",
    category_id: "bills.phone",
    flow: null,
  },
  {
    pattern: "\\b(icloud|apple\\.com/bill|apple services)\\b",
    category_id: "subscriptions.essentials",
    flow: null,
  },
  {
    pattern: "\\b(hetzner|digitalocean|vultr|linode|contabo|hostinger vps|vps)\\b",
    category_id: "subscriptions.professional",
    flow: null,
  },
  {
    pattern: "\\b(namecheap|godaddy|porkbun|cloudflare|domain)\\b",
    category_id: "subscriptions.professional",
    flow: null,
  },
  {
    pattern: "\\b(pandapro|panda ?pro|food ?panda pro)\\b",
    category_id: "subscriptions.enjoyment",
    flow: null,
  },
  {
    pattern: "\\b(food ?panda|cheetay|kfc|mcdonald|burger|pizza|cafe|restaurant|dhaba|crumbl?e)\\b",
    category_id: "food",
    flow: null,
  },
  { pattern: "\\b(gym|creatine|barber|salon|haircut)\\b", category_id: "self.routine", flow: null },
  { pattern: "\\b(spa|mani|pedi)\\b", category_id: "self.indulgences", flow: null },
  {
    pattern: "\\b(edhi|saylani|chhipa|zakat|sadqa|sadaqah|donation|charity)\\b",
    category_id: "charity",
    flow: null,
  },
  { pattern: "\\b(pharmacy|dvago|medical store|clinic|hospital)\\b", category_id: "health", flow: null },
  { pattern: "\\b(service charges?|fee|tax deducted|withholding)\\b", category_id: "fees", flow: "fee" },
  // Meezan alone isn't funding (anyone can bank there): funding = a transfer from *you* (see classify.inferFlow)
  { pattern: "\\bown[- ]account transfer\\b", category_id: null, flow: "funding" },
  {
    pattern: "\\b(spotify|netflix|youtube premium|disney\\+?|prime video|apple music)\\b",
    category_id: "subscriptions.enjoyment",
    flow: null,
  },
];
