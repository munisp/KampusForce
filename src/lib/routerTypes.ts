import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../api/router";

export type RouterOutputs = inferRouterOutputs<AppRouter>;
