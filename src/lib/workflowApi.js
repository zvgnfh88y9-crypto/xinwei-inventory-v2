import { supabase } from './supabaseClient';
import { getUserErrorMessage } from './userError';

const invokeWorkflow = async (action, payload = {}) => {
  if (!supabase) throw new Error('Supabase 尚未配置');
  const { data, error } = await supabase.functions.invoke('workflow-action', { body: { action, ...payload } });
  
  if (error) {
    let responseBody = null;
    if (error.context?.clone) {
      try {
        responseBody = await error.context.clone().json();
      } catch {
        responseBody = null;
      }
    }
    const contextBody = error.context?.body;
    const contextMessage = responseBody?.error
      || responseBody?.message
      || contextBody?.error
      || contextBody?.message;
    throw new Error(getUserErrorMessage(contextMessage || error.message, '流程服务请求失败'));
  }
  
  if (data?.error) throw new Error(getUserErrorMessage(data.error, '流程服务请求失败'));
  return data;
};

export const listWorkflowDocuments = async (direction = '') => (await invokeWorkflow('list', direction ? { direction } : {})).documents || [];
export const updateWorkflowDocument = async (document_id, document, lines) => invokeWorkflow('update', { document_id, document, lines });
export const captureWorkflowDocument = async (document, lines = []) => invokeWorkflow('capture', { document, lines });
export const createWorkflowDocument = async (document, lines) => invokeWorkflow('create', { document, lines });
export const submitWorkflowDocument = async (document_id) => invokeWorkflow('submit', { document_id });
export const approveDraftWorkflowDocument = async (document_id) => invokeWorkflow('approve_draft', { document_id });
export const deleteWorkflowDocument = async (document_id) => invokeWorkflow('delete', { document_id });
export const deleteBulkWorkflowDocuments = async (ids) => invokeWorkflow('delete_bulk', { ids });
export const reviewWorkflowDocument = async (document_id, approved, reason) => invokeWorkflow('review', { document_id, approved, reason });
export const finalReviewWorkflowDocument = async (document_id, approved, reason) => invokeWorkflow('final_review', { document_id, approved, reason });
export const reopenWorkflowDocument = async (document_id, reason) => invokeWorkflow('reopen', { document_id, reason });
export const postWorkflowDocument = async (document_id) => invokeWorkflow('post', { document_id });
export const voidWorkflowDocument = async (document_id, reason) => invokeWorkflow('void', { document_id, reason });
export const listWorkflowMovements = async (document_id) => (await invokeWorkflow('movements', { document_id })).movements || [];
export const getDailyWorkflowSummary = async (business_date) => (await invokeWorkflow('summary', { business_date })).summary;
export const getWorkflowHomeSummary = async () => (await invokeWorkflow('home_summary')).summary;
export const reviseRejectedWorkflowDocument = async (document_id, previous_reason) => invokeWorkflow('revise_rejected', { document_id, previous_reason });
export const listWorkflowNotifications = async (limit = 30) => invokeWorkflow('notifications', { limit });
export const markWorkflowNotificationRead = async (notification_id) => invokeWorkflow('mark_notification_read', { notification_id });
export const markWorkflowNotificationsReadByDocument = async (document_id) => invokeWorkflow('mark_document_notifications_read', { document_id });
export const markAllWorkflowNotificationsRead = async () => invokeWorkflow('mark_all_notifications_read');
export const listWorkflowApprovalTimeline = async (document_id) => (await invokeWorkflow('approval_timeline', { document_id })).events || [];
