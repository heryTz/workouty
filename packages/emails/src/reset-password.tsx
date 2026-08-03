import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Text,
} from '@react-email/components'

export type ResetPasswordEmailProps = {
  url: string
}

export function ResetPasswordEmail({ url }: ResetPasswordEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>Reset your Workouty password</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={heading}>Reset your password</Heading>
          <Text style={text}>
            We received a request to reset the password for your Workouty
            account. Click the button below to choose a new password.
          </Text>
          <Button style={button} href={url}>
            Reset password
          </Button>
          <Text style={text}>
            If the button above doesn&apos;t work, copy and paste this link
            into your browser:
          </Text>
          <Text style={link}>{url}</Text>
          <Text style={footer}>
            If you didn&apos;t request a password reset, you can safely
            ignore this email.
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

export default ResetPasswordEmail

const main = {
  backgroundColor: '#f6f9fc',
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
}

const container = {
  backgroundColor: '#ffffff',
  margin: '0 auto',
  padding: '32px',
  maxWidth: '480px',
}

const heading = {
  fontSize: '24px',
  fontWeight: '600',
  color: '#1a1a1a',
}

const text = {
  fontSize: '14px',
  lineHeight: '22px',
  color: '#3c3c3c',
}

const button = {
  backgroundColor: '#5850ec',
  borderRadius: '6px',
  color: '#ffffff',
  fontSize: '14px',
  fontWeight: '600',
  textDecoration: 'none',
  textAlign: 'center' as const,
  display: 'block',
  padding: '12px 20px',
  margin: '24px 0',
}

const link = {
  fontSize: '14px',
  color: '#5850ec',
  wordBreak: 'break-all' as const,
}

const footer = {
  fontSize: '12px',
  color: '#8a8a8a',
  marginTop: '24px',
}
