import { Router, type IRouter } from "express";
import {
  SearchTariffMatchesBody,
  ListTariffCodesQueryParams,
} from "@workspace/api-zod";
import { searchTariffMatches, listTariffCodes } from "../lib/tariffMatcher";

const router: IRouter = Router();

router.post("/tariff/search", async (req, res): Promise<void> => {
  const parsed = SearchTariffMatchesBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.message }, "Invalid tariff search body");
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { query, queryType, direction } = parsed.data;
  const result = await searchTariffMatches(query, queryType, direction);
  res.json(result);
});

router.get("/tariff/codes", async (req, res): Promise<void> => {
  const parsed = ListTariffCodesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const codes = listTariffCodes(parsed.data.country);
  res.json(codes);
});

export default router;
