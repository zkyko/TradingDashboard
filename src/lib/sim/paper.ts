export type Side = "long" | "short" | "flat";

export type PaperFill = {
  id: string;
  t: number;
  side: "buy" | "sell";
  qty: number;
  price: number;
  reason: "entry" | "exit";
};

export type PaperState = {
  side: Side;
  qty: number;
  avgEntry: number;
  unrealized: number;
  realized: number;
  fills: PaperFill[];
};

export class PaperBook {
  side: Side = "flat";
  qty = 0;
  avgEntry = 0;
  realized = 0;
  fills: PaperFill[] = [];
  private fillSeq = 0;

  state(mark: number): PaperState {
    return {
      side: this.side,
      qty: this.qty,
      avgEntry: this.avgEntry,
      unrealized: this.unrealized(mark),
      realized: this.realized,
      fills: [...this.fills],
    };
  }

  unrealized(mark: number) {
    if (this.side === "flat" || this.qty <= 0) return 0;
    if (this.side === "long") return (mark - this.avgEntry) * this.qty;
    return (this.avgEntry - mark) * this.qty;
  }

  long(qty: number, price: number, t: number) {
    const q = Math.max(1, Math.floor(qty));
    if (this.side === "short") this.flat(price, t);
    if (this.side === "flat") {
      this.side = "long";
      this.qty = q;
      this.avgEntry = price;
    } else {
      const total = this.avgEntry * this.qty + price * q;
      this.qty += q;
      this.avgEntry = total / this.qty;
    }
    this.pushFill("buy", q, price, t, "entry");
  }

  short(qty: number, price: number, t: number) {
    const q = Math.max(1, Math.floor(qty));
    if (this.side === "long") this.flat(price, t);
    if (this.side === "flat") {
      this.side = "short";
      this.qty = q;
      this.avgEntry = price;
    } else {
      const total = this.avgEntry * this.qty + price * q;
      this.qty += q;
      this.avgEntry = total / this.qty;
    }
    this.pushFill("sell", q, price, t, "entry");
  }

  flat(price: number, t: number) {
    if (this.side === "flat" || this.qty <= 0) return;
    const pnl =
      this.side === "long"
        ? (price - this.avgEntry) * this.qty
        : (this.avgEntry - price) * this.qty;
    this.realized += pnl;
    this.pushFill(this.side === "long" ? "sell" : "buy", this.qty, price, t, "exit");
    this.side = "flat";
    this.qty = 0;
    this.avgEntry = 0;
  }

  private pushFill(
    side: "buy" | "sell",
    qty: number,
    price: number,
    t: number,
    reason: "entry" | "exit",
  ) {
    this.fills.unshift({
      id: `f-${++this.fillSeq}`,
      t,
      side,
      qty,
      price,
      reason,
    });
    if (this.fills.length > 40) this.fills.pop();
  }
}
