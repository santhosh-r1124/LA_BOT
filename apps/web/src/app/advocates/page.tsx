import { cookies } from 'next/headers';
import { Suspense } from 'react';
import { AdvocateDirectory } from './_components/directory';
import { DirectoryLoading } from './_components/directory-loading';
import { SAMPLE_NOTICE_COOKIE } from './_components/notice-cookie';
import { loadFacets } from './_components/server-data';

/**
 * Fetches the two things the first paint needs: how much of the directory is
 * sample data, and whether this visitor dismissed the notice about it. With
 * both known up front, the notice is either in the first paint or not at all, so
 * nothing moves when the page arrives.
 */
async function DirectoryWithFacets() {
  const [facets, jar] = await Promise.all([loadFacets(), cookies()]);
  return (
    <AdvocateDirectory
      initialFacets={facets}
      initialNoticeDismissed={jar.get(SAMPLE_NOTICE_COOKIE)?.value === 'dismissed'}
    />
  );
}

/**
 * The directory. Only the facets are fetched on the server; filters and results
 * run in the browser, which keeps the address bar and the results in step. The
 * fallback has its own boundary here so the app-wide loading screen (short, with
 * the footer in view) never flashes in front of this page.
 */
export default function AdvocatesPage() {
  return (
    <Suspense fallback={<DirectoryLoading />}>
      <DirectoryWithFacets />
    </Suspense>
  );
}
