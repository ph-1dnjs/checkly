import type { MainDomain } from "../ipc/domain";
import { registerApiTesting } from "./main/register";

export const apiTestingDomain: MainDomain = {
  register: registerApiTesting,
};
