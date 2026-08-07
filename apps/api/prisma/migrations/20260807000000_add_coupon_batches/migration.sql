-- Lotes de cupones: N códigos de un solo uso generados de una vez (una palabra
-- del dueño + sufijo aleatorio por código), para repartir en campañas.
--
-- Aditiva y sin backfill: ambas columnas son nullable y los cupones que ya
-- existen quedan con batch_id NULL, que es exactamente lo que significan — se
-- crearon sueltos, a mano. El código viejo que hace SELECT * los ignora.
ALTER TABLE "billing_coupons" ADD COLUMN IF NOT EXISTS "batch_id" TEXT;
ALTER TABLE "billing_coupons" ADD COLUMN IF NOT EXISTS "batch_label" TEXT;

-- El listado agrupa por lote y filtra por él en cada apertura del panel.
CREATE INDEX IF NOT EXISTS "billing_coupons_batch_id_idx" ON "billing_coupons"("batch_id");
