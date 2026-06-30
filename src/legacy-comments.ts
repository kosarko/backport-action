import dedent from "dedent";

import {
  CheckoutError,
  CherryPickError,
  CreatePRError,
  GitPushError,
  TargetResult,
} from "./errors.js";
import { GitRefNotFoundError } from "./git.js";

export function composeFailureMessage(
  result: Extract<TargetResult, { status: "failed" }>,
  targetRemote: string = "origin",
): string {
  const { targetBranch, error } = result;
  if (error instanceof GitRefNotFoundError) {
    return composeMessageForFetchTargetFailure(error.ref);
  }
  if (error instanceof CheckoutError) {
    return composeMessageForCheckoutFailure(
      targetBranch,
      error.branch,
      error.commits,
      targetRemote,
    );
  }
  if (error instanceof CherryPickError) {
    return composeMessageForCherryPickFailure(
      targetBranch,
      error.branch,
      error.commits,
      targetRemote,
    );
  }
  if (error instanceof GitPushError) {
    return composeMessageForGitPushFailure(targetBranch, error.exitCode);
  }
  if (error instanceof CreatePRError) {
    return composeMessageForCreatePRFailed(error);
  }
  return error.message;
}

export function composeMessageForSuccess(
  pr_number: number,
  target: string,
  downstream: string,
): string {
  return dedent`Successfully created backport PR for \`${target}\`:
                - ${downstream}#${pr_number}`;
}

export function composeMessageForSuccessWithConflicts(
  pr_number: number,
  target: string,
  downstream: string,
  branchname: string,
  commitShasToCherryPick: string[],
  conflictResolution: string,
): string {
  const suggestionToResolve = composeMessageToResolveCommittedConflicts(
    target,
    branchname,
    commitShasToCherryPick,
    conflictResolution,
  );
  return dedent`Created backport PR for \`${target}\`:
                - ${downstream}#${pr_number} with remaining conflicts!

                ${suggestionToResolve}`;
}

export function composeMessageToResolveCommittedConflicts(
  target: string,
  branchname: string,
  commitShasToCherryPick: string[],
  conflictResolution: string,
): string {
  const suggestion = composeSuggestion(
    target,
    branchname,
    commitShasToCherryPick,
    true,
    conflictResolution,
  );

  return dedent`Please cherry-pick the changes locally and resolve any conflicts.
                ${suggestion}`;
}

function composeMessageForFetchTargetFailure(target: string): string {
  return dedent`Backport failed for \`${target}\`: couldn't find remote ref \`${target}\`.
                Please ensure that this GitHub repo has a branch named \`${target}\`.`;
}

function composeMessageForCheckoutFailure(
  target: string,
  branchname: string,
  commitShasToCherryPick: string[],
  targetRemote: string = "origin",
): string {
  const reason = "because it was unable to create a new branch";
  const suggestion = composeSuggestion(
    target,
    branchname,
    commitShasToCherryPick,
    false,
    "fail",
    targetRemote,
  );
  return dedent`Backport failed for \`${target}\`, ${reason}.

                Please cherry-pick the changes locally.
                ${suggestion}`;
}

function composeMessageForCherryPickFailure(
  target: string,
  branchname: string,
  commitShasToCherryPick: string[],
  targetRemote: string = "origin",
): string {
  const reason = "because it was unable to cherry-pick the commit(s)";

  const suggestion = composeSuggestion(
    target,
    branchname,
    commitShasToCherryPick,
    false,
    "fail",
    targetRemote,
  );

  return dedent`Backport failed for \`${target}\`, ${reason}.

                Please cherry-pick the changes locally and resolve any conflicts.
                ${suggestion}`;
}

function composeMessageForGitPushFailure(
  target: string,
  exitcode: number,
): string {
  //TODO better error messages depending on exit code
  return dedent`Git push to origin failed for ${target} with exitcode ${exitcode}`;
}

function composeMessageForCreatePRFailed(error: CreatePRError): string {
  const { details } = error;
  if (!details) {
    return dedent`Backport branch created but failed to create PR.
                  Request to create PR rejected with status ${error.status}.

                  (see action log for full response)`;
  }

  const { owner, repo, title, body, head, base } = details;
  const encodedTitle = encodeURIComponent(title);
  const encodedBody = encodeURIComponent(body);
  const createPRUrl = `https://github.com/${owner}/${repo}/compare/${base}...${head}?expand=1&title=${encodedTitle}&body=${encodedBody}`;

  const ghCliCommand = `gh pr create --repo ${owner}/${repo} --base ${base} --head ${head} --title "${title.replace(/"/g, '\\"')}" --body "${body.replace(/"/g, '\\"')}"`;

  return dedent`Backport branch created but failed to create PR.
              Request to create PR rejected with status ${error.status}.

              Please create the PR manually:
              - [Create PR via GitHub UI](${createPRUrl})

              Or via GitHub CLI:
              \`\`\`bash
              ${ghCliCommand}
              \`\`\`

              (see action log for full error response)`;
}

function composeSuggestion(
  target: string,
  branchname: string,
  commitShasToCherryPick: string[],
  branchExist: boolean,
  conflictResolution: string = "fail",
  // Remote the target branch is read from. For a downstream backport the
  // target lives on the `downstream` remote, not origin. The already-pushed
  // backport branch (branchExist case) always lives on origin (our fork).
  targetRemote: string = "origin",
) {
  if (branchExist) {
    if (conflictResolution === "draft_commit_conflicts") {
      return dedent`\`\`\`bash
      git fetch origin ${branchname}
      git worktree add --checkout .worktree/${branchname} ${branchname}
      cd .worktree/${branchname}
      git reset --hard HEAD^
      git cherry-pick -x ${commitShasToCherryPick.join(" ")}
      \`\`\``;
    } else {
      return "";
    }
  } else {
    return dedent`\`\`\`bash
    git fetch ${targetRemote} ${target}
    git worktree add -d .worktree/${branchname} ${targetRemote}/${target}
    cd .worktree/${branchname}
    git switch --create ${branchname}
    git cherry-pick -x ${commitShasToCherryPick.join(" ")}
    \`\`\``;
  }
}
