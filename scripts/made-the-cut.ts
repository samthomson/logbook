/** Tags for the Compass kind-7 marker displayed by clients as "made the cut". */
export function madeTheCutReactionTags(segmentId: string, segmentAuthorPubkey: string): string[][] {
  return [
    ['e', segmentId],
    ['p', segmentAuthorPubkey],
    ['k', '4200'],
  ]
}
