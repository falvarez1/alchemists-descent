export const BUILDER_REQUEST_CLOSE_EVENT = 'builder-request-close';

export interface BuilderCloseRequestDetail {
  reason: 'play-button';
  result?: Promise<boolean>;
}
