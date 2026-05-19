const MIN_SIMILARITY = 0.2

/**
 * Similarité cosinus entre deux vecteurs.
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number} valeur entre -1 et 1 (1 = identique)
 */
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

/**
 * Retrouve les K chunks les plus pertinents pour une query.
 * @param {object} stmts - Prepared statements
 * @param {string} query - Question de l'utilisateur
 * @param {number} k - Nombre de résultats
 * @returns {Promise<{source, section, content, similarity}[]>}
 */
export async function retrieve(getEmbedding: (text: string) => Promise<number[]>, dbPort: { getAllChunks: () => any[] }, query: string, k = 4): Promise<Array<any>> {
  const queryEmbedding = await getEmbedding(query)

  // Récupère tous les chunks avec leurs embeddings
  const chunks = await dbPort.getAllChunks()

  // Calcule la similarité cosinus pour chaque chunk
  const ranked = chunks
    .map((chunk: any) => {
      const embedding: number[] = JSON.parse(chunk.embedding)
      const similarity = cosineSimilarity(queryEmbedding, embedding)
      return { ...chunk, similarity }
    })
    .filter((c: any) => c.similarity >= MIN_SIMILARITY)
    .sort((a: any, b: any) => b.similarity - a.similarity)
    .slice(0, k)

  return ranked
}
