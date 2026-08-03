import { render } from '@react-email/render'
import { ResetPasswordEmail } from './reset-password'

export type { ResetPasswordEmailProps } from './reset-password'
export { ResetPasswordEmail } from './reset-password'

export type RenderedEmail = {
  html: string
  text: string
}

export async function renderResetPassword(props: {
  url: string
}): Promise<RenderedEmail> {
  const element = <ResetPasswordEmail {...props} />
  const [html, text] = await Promise.all([
    render(element),
    render(element, { plainText: true }),
  ])
  return { html, text }
}
