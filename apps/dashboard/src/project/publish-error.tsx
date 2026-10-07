import { Button, Flash } from '@primer/react';
import { SenvApiError } from '@senv/api-client';
import { describePublishIssue, readPublishIssues } from './publish-issues';

/** 게시·되돌리기 실패 안내. 409 충돌이면 최신 상태를 다시 불러오는 버튼을 붙인다 */
export function PublishError({
  error,
  reload,
}: {
  error: Error;
  reload?: { label: string; onClick: () => void };
}) {
  if (!(error instanceof SenvApiError)) {
    return <Flash variant="danger">게시하지 못했습니다. 잠시 후 다시 시도하세요.</Flash>;
  }
  if (error.code === 'version_conflict') {
    return (
      <Flash variant="danger">
        {error.message} {reload && <Button onClick={reload.onClick}>{reload.label}</Button>}
      </Flash>
    );
  }
  const issues = readPublishIssues(error.details);
  return (
    <Flash variant="danger">
      {error.message}
      {issues.length > 0 && (
        <ul>
          {issues.map((issue) => (
            <li key={`${issue.code}:${issue.project ?? ''}:${issue.key}:${issue.reference ?? ''}`}>
              {describePublishIssue(issue)}
            </li>
          ))}
        </ul>
      )}
    </Flash>
  );
}
