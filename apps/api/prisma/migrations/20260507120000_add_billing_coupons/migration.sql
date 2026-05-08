-- CreateTable: billing_coupons
CREATE TABLE "billing_coupons" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL,
    "percent_discount" INTEGER,
    "amount_off_cents" INTEGER,
    "free_months" INTEGER,
    "duration_cycles" INTEGER,
    "applies_to_plan_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "max_redemptions" INTEGER,
    "redemption_count" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "billing_coupons_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "billing_coupons_code_key" ON "billing_coupons"("code");
CREATE INDEX "billing_coupons_is_active_expires_at_idx" ON "billing_coupons"("is_active", "expires_at");

-- CreateTable: billing_coupon_redemptions
CREATE TABLE "billing_coupon_redemptions" (
    "id" TEXT NOT NULL,
    "coupon_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "subscription_id" TEXT,
    "redeemed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cycles_remaining" INTEGER,
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "billing_coupon_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "billing_coupon_redemptions_coupon_id_tenant_id_key" ON "billing_coupon_redemptions"("coupon_id", "tenant_id");
CREATE INDEX "billing_coupon_redemptions_tenant_id_idx" ON "billing_coupon_redemptions"("tenant_id");

-- AddForeignKey
ALTER TABLE "billing_coupon_redemptions" ADD CONSTRAINT "billing_coupon_redemptions_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "billing_coupons"("id") ON DELETE CASCADE ON UPDATE CASCADE;
