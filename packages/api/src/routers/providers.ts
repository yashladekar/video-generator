import { protectedProcedure, router } from "../index";
import {
  deleteProviderInputSchema,
  pricingUpsertInputSchema,
  providerListInputSchema,
  testProviderInputSchema,
  upsertProviderInputSchema,
} from "../schemas/providers";
import {
  deleteProviderConfig,
  detectCapabilities,
  listProviderConfigs,
  testProvider,
  upsertProviderConfig,
} from "../services/provider-config";

export const providersRouter = router({
  catalog: protectedProcedure.query(async ({ ctx }) => {
    return detectCapabilities(ctx);
  }),
  list: protectedProcedure
    .input(providerListInputSchema)
    .query(async ({ ctx, input }) => {
      return listProviderConfigs(ctx, ctx.session.user.id, input.category);
    }),
  upsert: protectedProcedure
    .input(upsertProviderInputSchema)
    .mutation(async ({ ctx, input }) => {
      return upsertProviderConfig(ctx, ctx.session.user.id, input);
    }),
  test: protectedProcedure
    .input(testProviderInputSchema)
    .mutation(async ({ ctx, input }) => {
      return testProvider(
        ctx,
        ctx.session.user.id,
        input.category,
        input.provider,
      );
    }),
  delete: protectedProcedure
    .input(deleteProviderInputSchema)
    .mutation(async ({ ctx, input }) => {
      await deleteProviderConfig(
        ctx,
        ctx.session.user.id,
        input.category,
        input.provider,
      );
      return { ok: true };
    }),
  pricing: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.providerPricing.findMany({
      orderBy: [{ provider: "asc" }, { model: "asc" }],
    });
  }),
  upsertPricing: protectedProcedure
    .input(pricingUpsertInputSchema)
    .mutation(async ({ ctx, input }) => {
      return ctx.db.providerPricing.upsert({
        where: {
          provider_model_unit: {
            provider: input.provider,
            model: input.model,
            unit: input.unit,
          },
        },
        update: {
          category: input.category,
          unitPriceUsd: input.unitPriceUsd,
          sourceUrl: input.sourceUrl,
          active: input.active,
          verifiedAt: new Date(),
        },
        create: {
          provider: input.provider,
          model: input.model,
          category: input.category,
          unit: input.unit,
          unitPriceUsd: input.unitPriceUsd,
          sourceUrl: input.sourceUrl,
          active: input.active,
          verifiedAt: new Date(),
        },
      });
    }),
});
