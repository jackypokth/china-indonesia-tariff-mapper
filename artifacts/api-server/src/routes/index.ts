import { Router, type IRouter } from "express";
import healthRouter from "./health";
import tariffRouter from "./tariff";

const router: IRouter = Router();

router.use(healthRouter);
router.use(tariffRouter);

export default router;
