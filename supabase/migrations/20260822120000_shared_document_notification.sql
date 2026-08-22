-- 2026-08-22 Notification Fix: Notify admins when new shared documents are uploaded (WeChat/Manual).
-- This ensures admins see real-time alerts when uploader accounts submit delivery/outbound notes.

CREATE OR REPLACE FUNCTION public.notify_admin_on_shared_document_upload()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_admin_id uuid;
    v_kind_label text;
BEGIN
    v_kind_label := CASE 
        WHEN NEW.document_kind = 'delivery_note' THEN '送货单'
        WHEN NEW.document_kind = 'receipt_note' THEN '送货单'
        WHEN NEW.document_kind = 'outbound_note' THEN '出库单'
        ELSE '业务资料'
    END;

    -- 向所有管理员发送通知
    FOR v_admin_id IN 
        SELECT id FROM public.profiles WHERE role = 'admin' AND is_disabled = false
    LOOP
        INSERT INTO public.workflow_notifications (
            recipient_id,
            event_type,
            title,
            message,
            route,
            document_id
        ) VALUES (
            v_admin_id,
            'archive_uploaded',
            '收到新的' || v_kind_label,
            '由 ' || COALESCE(NEW.uploaded_by_name, '快速上传员') || ' 上传于 ' || NEW.document_date || '，请及时查看并处理。',
            '/approval', -- 资料归档面板在审批中心页面
            NEW.id
        );
    END LOOP;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_shared_document_upload_notify ON public.shared_document_archive;
CREATE TRIGGER tr_shared_document_upload_notify
    AFTER INSERT ON public.shared_document_archive
    FOR EACH ROW
    EXECUTE FUNCTION public.notify_admin_on_shared_document_upload();
