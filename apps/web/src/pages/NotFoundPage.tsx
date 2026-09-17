import { Link } from 'react-router'

export default function NotFoundPage() {
  return (
    <main className="mx-auto flex max-w-xl flex-col items-start gap-4 p-8">
      <h1 className="text-2xl font-semibold text-foreground">Page not found</h1>
      <Link className="text-primary underline" to="/">
        Back to the dashboard
      </Link>
    </main>
  )
}
