import { ApiProperty } from '@nestjs/swagger';
import { OfferStatus } from '../entities/offer.entity';

/**
 * Shown in Swagger under employer Candidates → Offers endpoints.
 * Next.js integration notes for the frontend team.
 */
export const EMPLOYER_OFFERS_SUBTAB_NEXTJS_GUIDE = `
## Next.js — Candidates tab (Offers subtab)

**Auth (employer):** JWT via httpOnly \`access_token\` cookie (login sets it) or \`Authorization: Bearer <token>\` from your BFF.
Use \`credentials: 'include'\` on fetch when the app and API share a cookie domain; otherwise proxy through a Next Route Handler and forward the Bearer token.

**Base URL:** \`\${NEXT_PUBLIC_API_URL}/api/v1\`

### 1) Initial list
\`GET /employer/candidates/offers\` — optional \`?page=&limit=&status=pending|accepted|declined|expired|withdrawn\`.
Default (no \`status\`) returns all interview invite lifecycle statuses.
JSON is wrapped: \`{ status_code, message, data: { offers, total, page, limit, totalPages, emptyStateMessage } }\`.
When the employer has never sent an offer, \`emptyStateMessage\` is the copy for the empty state; otherwise \`null\` (render your list or a filtered-empty UI).

### 2) View Offer modal (read-only)
\`GET /employer/offers/:offerId\` — full offer + \`candidate\`. No employer PATCH; display only.

### 3) Live status when a candidate responds
\`GET /employer/candidates/offers/events\` — **SSE** (\`text/event-stream\`), not JSON.
- Open while the Offers subtab is mounted; close on unmount.
- Same auth as above (cookie or Bearer).
- Lines: \`data: <JSON>\` (ignore \`: heartbeat\` comments).
- Event \`type\`: \`offer_status_changed\`; \`status\`: \`accepted\` | \`declined\`.
- On event: update the row in state, or refetch the list.

**Browser (same-site cookies):**
\`\`\`ts
const es = new EventSource(\`\${API}/employer/candidates/offers/events\`, { withCredentials: true });
es.onmessage = (e) => { const ev = JSON.parse(e.data); /* patch list */ };
\`\`\`

**Bearer (App Router client / no cookie to API):** use \`fetch()\` + \`ReadableStream\` (EventSource cannot set Authorization), or a Route Handler that streams from the API.

**CORS:** API \`CORS_ORIGIN\` must include the Next.js origin; \`credentials: true\` is enabled on the API.
`.trim();

export class EmployerCandidatesOfferEntryDto {
  @ApiProperty({ format: 'uuid' })
  offerId: string;

  @ApiProperty({ format: 'uuid' })
  candidateUserId: string;

  @ApiProperty({ example: 'Ada Lovelace' })
  candidateName: string;

  @ApiProperty({ example: 'frontend_developer', nullable: true })
  roleTrack: string | null;

  @ApiProperty({ example: 'Senior Frontend Engineer' })
  jobTitle: string;

  @ApiProperty({ type: String, format: 'date-time' })
  dateSent: Date;

  @ApiProperty({ enum: OfferStatus, example: OfferStatus.PENDING })
  status: OfferStatus;
}

export class EmployerCandidatesOffersListDataDto {
  @ApiProperty({ type: [EmployerCandidatesOfferEntryDto] })
  offers: EmployerCandidatesOfferEntryDto[];

  @ApiProperty({ example: 2 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  limit: number;

  @ApiProperty({ example: 1 })
  totalPages: number;

  @ApiProperty({
    nullable: true,
    example:
      'No offers sent yet. Discover candidates and send your first offer.',
    description:
      'Empty-state copy when the employer has never sent an offer; null otherwise.',
  })
  emptyStateMessage: string | null;
}

export class OfferStatusChangeEventDto {
  @ApiProperty({ example: 'offer_status_changed' })
  type: 'offer_status_changed';

  @ApiProperty({ format: 'uuid' })
  offerId: string;

  @ApiProperty({ format: 'uuid' })
  candidateUserId: string;

  @ApiProperty({ example: 'Ada Lovelace' })
  candidateName: string;

  @ApiProperty({ example: 'Senior Frontend Engineer' })
  roleTitle: string;

  @ApiProperty({
    enum: [OfferStatus.ACCEPTED, OfferStatus.DECLINED],
  })
  status: OfferStatus.ACCEPTED | OfferStatus.DECLINED;

  @ApiProperty({ type: String, format: 'date-time' })
  respondedAt: string;
}
