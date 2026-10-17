import type { Env } from './types';

type DataApiReply<T> = { documents?: T[]; document?: T; matchedCount?: number; modifiedCount?: number; insertedId?: string };

/** HTTP-only MongoDB Data API adapter. No native MongoDB driver or Mongoose is used. */
export class MongoDataApi {
  constructor(private readonly env: Env) {}

  async action<T>(name: string, collection: string, payload: Record<string, unknown> = {}): Promise<DataApiReply<T>> {
    if (!this.env.MONGODB_DATA_API_URL || !this.env.MONGODB_DATA_API_KEY) {
      throw new Error('MongoDB HTTP Data API is not configured.');
    }
    const base = this.env.MONGODB_DATA_API_URL.replace(/\/$/, '');
    const response = await fetch(`${base}/${name}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'api-key': this.env.MONGODB_DATA_API_KEY },
      body: JSON.stringify({
        dataSource: this.env.MONGODB_DATASOURCE,
        database: this.env.MONGODB_DATABASE,
        collection,
        ...payload,
      }),
    });
    const body = await response.json().catch(() => ({})) as DataApiReply<T> & { error?: string; error_code?: string };
    if (!response.ok) throw new Error(body.error || `MongoDB Data API returned ${response.status}.`);
    return body;
  }

  find<T>(collection: string, filter: Record<string, unknown>, limit = 100) {
    return this.action<T>('find', collection, { filter, limit });
  }
  findOne<T>(collection: string, filter: Record<string, unknown>) {
    return this.action<T>('findOne', collection, { filter });
  }
  insertOne<T>(collection: string, document: Record<string, unknown>) {
    return this.action<T>('insertOne', collection, { document });
  }
  updateOne<T>(collection: string, filter: Record<string, unknown>, update: Record<string, unknown>, upsert = false) {
    return this.action<T>('updateOne', collection, { filter, update, upsert });
  }
  deleteOne<T>(collection: string, filter: Record<string, unknown>) {
    return this.action<T>('deleteOne', collection, { filter });
  }
}
