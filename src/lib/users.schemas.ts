import { z } from "zod";

export const CreateUserInput = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(8).max(200),
  initial_balance: z.number().min(0).max(1_000_000).default(0),
  max_tokens_limit: z.number().int().min(0).default(1_000_000),
  max_api_keys: z.number().int().min(1).max(100).default(5),
});

export const UpdateUserInput = z.object({
  id: z.string().uuid(),
  email: z.string().trim().email().max(254).optional(),
  password: z.string().min(8).max(200).optional(),
  suspended: z.boolean().optional(),
  suspended_reason: z.string().max(500).optional(),
  is_frozen: z.boolean().optional(),
  max_tokens_limit: z.number().int().min(0).optional(),
  max_api_keys: z.number().int().min(1).max(100).optional(),
});