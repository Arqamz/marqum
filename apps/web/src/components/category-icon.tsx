import {
  Banknote,
  Bike,
  BookOpen,
  Briefcase,
  Bus,
  Car,
  Circle,
  Coffee,
  Coins,
  Dumbbell,
  Fuel,
  Gift,
  GraduationCap,
  HeartHandshake,
  House,
  Landmark,
  type LucideIcon,
  type LucideProps,
  PartyPopper,
  PawPrint,
  Phone,
  PiggyBank,
  Plane,
  Receipt,
  Repeat,
  Shirt,
  ShoppingBag,
  ShoppingCart,
  Smartphone,
  Sparkles,
  Stethoscope,
  Tv,
  User,
  Users,
  Utensils,
  Wallet,
  Wifi,
  Wrench,
  Zap,
} from "lucide-react";

/** Category icons are data (kebab-case lucide names). Unknown names fall back to a plain circle. */
export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  banknote: Banknote,
  bike: Bike,
  "book-open": BookOpen,
  briefcase: Briefcase,
  bus: Bus,
  car: Car,
  circle: Circle,
  coffee: Coffee,
  coins: Coins,
  dumbbell: Dumbbell,
  fuel: Fuel,
  gift: Gift,
  "graduation-cap": GraduationCap,
  "heart-handshake": HeartHandshake,
  house: House,
  home: House,
  landmark: Landmark,
  plane: Plane,
  "party-popper": PartyPopper,
  "paw-print": PawPrint,
  phone: Phone,
  "piggy-bank": PiggyBank,
  receipt: Receipt,
  repeat: Repeat,
  shirt: Shirt,
  "shopping-bag": ShoppingBag,
  "shopping-cart": ShoppingCart,
  smartphone: Smartphone,
  sparkles: Sparkles,
  stethoscope: Stethoscope,
  tv: Tv,
  user: User,
  users: Users,
  utensils: Utensils,
  wallet: Wallet,
  wifi: Wifi,
  wrench: Wrench,
  zap: Zap,
};

export function CategoryIcon({ name, ...props }: { name: string | undefined } & LucideProps) {
  const Icon = (name && CATEGORY_ICONS[name]) || Circle;
  return <Icon aria-hidden {...props} />;
}

/** Each top-level category keeps one colour everywhere (tile, bars). Unknown ids pick one by hash. */
const TINTS = [
  "bg-blue-subtle text-blue-vivid",
  "bg-orange-subtle text-orange-vivid",
  "bg-green-subtle text-green-vivid",
  "bg-purple-subtle text-purple-vivid",
  "bg-pink-subtle text-pink-vivid",
  "bg-teal-subtle text-teal-vivid",
  "bg-yellow-subtle text-yellow-vivid",
  "bg-cyan-subtle text-cyan-vivid",
  "bg-red-subtle text-red-vivid",
] as const;
const FIXED: Record<string, number> = {
  car: 0,
  food: 1,
  enjoyments: 3,
  self: 5,
  bills: 6,
  subscriptions: 4,
  charity: 2,
  misc: 7,
  health: 8,
  gifts: 4,
  fees: 7,
};

export function categoryTint(id: string | null | undefined): string {
  if (!id) return "bg-gray-subtle text-gray-vivid";
  const top = id.split(".")[0] ?? id;
  const i = FIXED[top] ?? [...top].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % TINTS.length;
  return TINTS[i] ?? TINTS[0];
}

/** The category's icon on its colour, in a rounded tile. */
export function CategoryTile({
  id,
  name,
  size = "md",
}: {
  id: string | null | undefined;
  name: string | undefined;
  size?: "sm" | "md";
}) {
  return (
    <span
      className={`inline-grid shrink-0 place-items-center rounded-md ${size === "sm" ? "size-8" : "size-10"} ${categoryTint(id)}`}
      aria-hidden
    >
      <CategoryIcon name={name} size={size === "sm" ? 16 : 20} />
    </span>
  );
}
