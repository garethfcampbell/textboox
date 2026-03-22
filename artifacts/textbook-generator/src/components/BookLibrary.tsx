import { useEffect, useState } from 'react';
import { Download, BookOpen, Clock } from 'lucide-react';

interface LibraryBook {
  id: number;
  title: string;
  topic: string;
  createdAt: string;
}

const FORMATS = ['pdf', 'epub', 'html'] as const;

export function BookLibrary() {
  const [books, setBooks] = useState<LibraryBook[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/textbook/library')
      .then((r) => r.json())
      .then((data) => {
        setBooks(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return null;
  if (books.length === 0) return null;

  return (
    <section className="w-full max-w-4xl mx-auto mt-20 mb-8">
      <div className="flex items-center gap-3 mb-8">
        <div className="w-10 h-10 rounded-xl bg-secondary flex items-center justify-center">
          <BookOpen className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h2 className="font-display text-2xl font-bold text-primary">Textbook Library</h2>
          <p className="text-sm text-muted-foreground">Curated textbooks, ready to download</p>
        </div>
      </div>

      <div className="grid gap-4">
        {books.map((book) => (
          <div
            key={book.id}
            className="bg-white border border-border rounded-2xl p-6 shadow-sm hover:shadow-md transition-shadow"
          >
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
              <div className="flex-1 min-w-0">
                <h3 className="font-display font-bold text-lg text-primary leading-tight mb-1 truncate">
                  {book.title}
                </h3>
                <p className="text-sm text-muted-foreground mb-2 truncate">{book.topic}</p>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Clock className="w-3 h-3" />
                  {new Date(book.createdAt).toLocaleDateString(undefined, {
                    year: 'numeric', month: 'long', day: 'numeric',
                  })}
                </div>
              </div>

              <div className="flex flex-wrap gap-2 shrink-0">
                {FORMATS.map((fmt) => (
                  <a
                    key={fmt}
                    href={`/api/textbook/library/${book.id}/download/${fmt}`}
                    download
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-secondary text-primary text-xs font-semibold uppercase tracking-wider hover:bg-accent/10 hover:text-accent transition-colors"
                  >
                    <Download className="w-3 h-3" />
                    {fmt}
                  </a>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
