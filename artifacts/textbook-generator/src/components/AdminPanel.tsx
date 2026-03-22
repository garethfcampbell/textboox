import { useEffect, useState } from 'react';
import { CheckCircle, XCircle, BookOpen, Clock, Download } from 'lucide-react';

interface AdminBook {
  id: number;
  jobId: string;
  title: string;
  topic: string;
  approved: boolean;
  createdAt: string;
}

const FORMATS = ['pdf', 'epub', 'html'] as const;

export function AdminPanel() {
  const [books, setBooks] = useState<AdminBook[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<number | null>(null);

  const fetchBooks = () => {
    fetch('/api/textbook/admin/books')
      .then((r) => r.json())
      .then((data) => {
        setBooks(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    fetchBooks();
  }, []);

  const toggleApproval = async (book: AdminBook) => {
    setToggling(book.id);
    try {
      const res = await fetch(`/api/textbook/admin/books/${book.id}/approve`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved: !book.approved }),
      });
      if (res.ok) {
        setBooks((prev) =>
          prev.map((b) => (b.id === book.id ? { ...b, approved: !b.approved } : b)),
        );
      }
    } finally {
      setToggling(null);
    }
  };

  return (
    <div className="min-h-screen bg-background px-4 py-12">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-3 mb-10">
          <div className="w-12 h-12 rounded-2xl bg-secondary flex items-center justify-center">
            <BookOpen className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="font-display text-3xl font-bold text-primary">Book Approval</h1>
            <p className="text-muted-foreground text-sm">Approve books to display them in the public library</p>
          </div>
        </div>

        {loading && (
          <p className="text-muted-foreground text-center py-16">Loading books…</p>
        )}

        {!loading && books.length === 0 && (
          <div className="text-center py-16 text-muted-foreground">
            <BookOpen className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p>No books generated yet. Generate one from the homepage.</p>
          </div>
        )}

        {!loading && books.length > 0 && (
          <div className="grid gap-4">
            {[...books].reverse().map((book) => (
              <div
                key={book.id}
                className={`bg-white border rounded-2xl p-6 shadow-sm transition-all ${
                  book.approved ? 'border-green-300 bg-green-50/30' : 'border-border'
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      {book.approved ? (
                        <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />
                      ) : (
                        <XCircle className="w-4 h-4 text-muted-foreground shrink-0" />
                      )}
                      <h3 className="font-display font-bold text-base text-primary leading-tight truncate">
                        {book.title}
                      </h3>
                    </div>
                    <p className="text-sm text-muted-foreground mb-2 pl-6 truncate">{book.topic}</p>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground pl-6">
                      <Clock className="w-3 h-3" />
                      {new Date(book.createdAt).toLocaleString(undefined, {
                        year: 'numeric', month: 'short', day: 'numeric',
                        hour: '2-digit', minute: '2-digit',
                      })}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {FORMATS.map((fmt) => (
                      <a
                        key={fmt}
                        href={`/api/textbook/library/${book.id}/download/${fmt}`}
                        download
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-secondary text-primary text-xs font-semibold uppercase tracking-wider hover:bg-accent/10 hover:text-accent transition-colors"
                      >
                        <Download className="w-3 h-3" />
                        {fmt}
                      </a>
                    ))}

                    <button
                      onClick={() => toggleApproval(book)}
                      disabled={toggling === book.id}
                      className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all disabled:opacity-50 ${
                        book.approved
                          ? 'bg-red-50 text-red-600 border border-red-200 hover:bg-red-100'
                          : 'bg-green-50 text-green-700 border border-green-200 hover:bg-green-100'
                      }`}
                    >
                      {toggling === book.id
                        ? '…'
                        : book.approved
                        ? 'Unapprove'
                        : 'Approve'}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-10 text-center">
          <a href="/" className="text-sm text-muted-foreground hover:text-primary transition-colors underline underline-offset-2">
            ← Back to homepage
          </a>
        </div>
      </div>
    </div>
  );
}
