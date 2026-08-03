import { z } from 'zod'

export const registerSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(200),
})

export const loginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(200),
})

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
})

export const resetRequestSchema = z.object({
  email: z.string().email().max(254),
})

export const resetSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8).max(200),
})

export type RegisterDto = z.infer<typeof registerSchema>
export type LoginDto = z.infer<typeof loginSchema>
export type RefreshDto = z.infer<typeof refreshSchema>
export type ResetRequestDto = z.infer<typeof resetRequestSchema>
export type ResetDto = z.infer<typeof resetSchema>
