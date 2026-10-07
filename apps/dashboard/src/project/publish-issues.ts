/** 서버가 게시를 거부할 때(422 publish_validation) details.issues에 담는 문제 하나 */
export interface PublishIssue {
  code: string;
  key: string;
  reference?: string;
  project?: string;
  /** invalid_type일 때 키 스키마의 타입 */
  expected?: string;
}

export function readPublishIssues(details: Record<string, unknown> | undefined): PublishIssue[] {
  const issues = details?.issues;
  if (!Array.isArray(issues)) return [];
  return issues.filter(
    (issue): issue is PublishIssue =>
      typeof issue === 'object' &&
      issue !== null &&
      typeof issue.code === 'string' &&
      typeof issue.key === 'string',
  );
}

export function describePublishIssue(issue: PublishIssue): string {
  switch (issue.code) {
    case 'invalid_key_name':
      return `${issue.key}: 키 이름은 대문자·숫자·밑줄만 쓸 수 있고 숫자로 시작할 수 없습니다`;
    case 'missing_reference':
      return `${issue.key}: ${issue.reference} 키가 공유 그룹에 없습니다`;
    case 'invalid_reference':
      return `${issue.key}: ${issue.reference} 참조 형식이 잘못되었습니다`;
    case 'reference_in_shared_group':
      return `${issue.key}: 공유 그룹 값은 다른 값을 참조할 수 없습니다`;
    case 'missing_required':
      return `${issue.key}: 필수 키인데 값이 없습니다`;
    case 'invalid_type':
      return `${issue.key}: ${issue.expected} 형식이 아닙니다`;
    case 'breaks_reference':
      return `${issue.project} 프로젝트의 ${issue.key}가 ${issue.reference}를 참조하고 있어 지울 수 없습니다`;
    default:
      return `${issue.key}: ${issue.code}`;
  }
}
