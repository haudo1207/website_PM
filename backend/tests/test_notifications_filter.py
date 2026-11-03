"""
Tests for notification filtering and demo notification creation.
Verifies that:
1. notify_task_done_if_zalo_linked does NOT send notifications to leaders of other workspaces.
2. get_inbox_notifications filters notifications by active workspace and project access/participation.
3. meeting_reminder notifications are preserved and isolated from task notifications.
"""
from datetime import date
from types import SimpleNamespace
import pytest
from app.models.user import User
from app.models.member import Member
from app.models.project import Project, project_members
from app.models.system_category import Customer, Workspace
from app.models.skill_master import Category, Group, Skill
from app.models.task import Task
from app.models.task_group import TaskGroup
from app.models.phase import Phase
from app.models.zalo import ZaloConversation
from app.models.notification import Notification
from app.routers.notifications import get_inbox_notifications
from app.services.zalo_task_parser import notify_task_done_if_zalo_linked


def test_notify_task_done_scoped_to_workspace(db, ws):
    """
    When a task in a Markee project is marked Done, only Markee leaders / PMs receive
    the notification — Infras leaders must NOT receive it.
    """
    cust_infra = Customer(name="Cust Infra", business_unit="infras")
    cust_markee = Customer(name="Cust Markee", business_unit="markee")
    db.add_all([cust_infra, cust_markee])
    db.commit()

    proj_infra = Project(name="Infra Project", business="Infras", data_scope="infras", customer_id=cust_infra.id)
    proj_markee = Project(name="Markee App", business="Markee", data_scope="markee", customer_id=cust_markee.id)
    db.add_all([proj_infra, proj_markee])
    db.commit()

    m_infra_leader = Member(display_name="Infra Leader", full_name="Infra Leader")
    m_markee_leader = Member(display_name="Markee Leader", full_name="Markee Leader")
    m_worker = Member(display_name="Dev Worker", full_name="Dev Worker")
    db.add_all([m_infra_leader, m_markee_leader, m_worker])
    db.commit()

    u_infra_leader = User(email="leader@infra.com", hashed_pw="pw", role="leader", data_scope="infras", member_id=m_infra_leader.id)
    u_markee_leader = User(email="leader@markee.com", hashed_pw="pw", role="leader", data_scope="markee", member_id=m_markee_leader.id)
    db.add_all([u_infra_leader, u_markee_leader])
    db.commit()

    conv_markee = ZaloConversation(project_id=proj_markee.id, name="Markee Zalo Group", zalo_thread_id="t1", account_id=1)
    db.add(conv_markee)

    phase = Phase(name="Phase 1", project_id=proj_markee.id)
    db.add(phase)
    db.commit()
    tg = TaskGroup(name="Group 1", phase_id=phase.id)
    db.add(tg)
    db.commit()
    cat = Category(name="IT")
    db.add(cat)
    db.flush()
    grp = Group(name="Network", category_id=cat.id)
    db.add(grp)
    db.flush()
    sk = Skill(name="Python", group_id=grp.id)
    db.add(sk)
    db.commit()

    task = Task(
        task_group_id=tg.id,
        detail="Implement login",
        task_code="T101",
        manday_est=1.0,
        start_date=date(2026, 11, 1),
        status="Done",
        assigned_id=m_worker.id,
        support_id=m_worker.id,
        skill_solution_id=grp.id,
        skill_vendor_id=sk.id,
    )
    db.add(task)
    db.commit()

    # Trigger notify_task_done_if_zalo_linked
    notify_task_done_if_zalo_linked(db, task, proj_markee.id)

    # Verify notifications
    infra_notifs = db.query(Notification).filter(Notification.recipient_id == u_infra_leader.id).all()
    markee_notifs = db.query(Notification).filter(Notification.recipient_id == u_markee_leader.id).all()

    assert len(infra_notifs) == 0, "Infras leader should not receive Markee demo notification"
    assert len(markee_notifs) == 1, "Markee leader should receive Markee demo notification"
    assert "Markee App" in markee_notifs[0].message


def test_inbox_notifications_filters_by_workspace_and_participation(db, ws):
    """
    GET /api/notifications/inbox?workspace=infras must only return notifications
    belonging to the Infras workspace and projects the user participates in.
    """
    cust_infra = Customer(name="Cust Infra", business_unit="infras")
    cust_markee = Customer(name="Cust Markee", business_unit="markee")
    db.add_all([cust_infra, cust_markee])
    db.commit()

    proj_infra = Project(name="Infra Project", business="Infras", data_scope="infras", customer_id=cust_infra.id)
    proj_markee = Project(name="Markee App", business="Markee", data_scope="markee", customer_id=cust_markee.id)
    db.add_all([proj_infra, proj_markee])
    db.commit()

    m_infra_leader = Member(display_name="Infra Leader", full_name="Infra Leader")
    db.add(m_infra_leader)
    db.commit()

    u_infra_leader = User(email="leader@infra.com", hashed_pw="pw", role="leader", data_scope="infras", member_id=m_infra_leader.id)
    db.add(u_infra_leader)
    db.commit()

    # Add user to project_members of infra project
    db.execute(project_members.insert().values(project_id=proj_infra.id, member_id=m_infra_leader.id, role="Leader"))
    db.commit()

    # Create 3 notifications:
    # 1. Valid meeting reminder in Infra
    # 2. Valid task demo notification in Infra
    # 3. Invalid task demo notification from Markee (simulating an old stale row)
    notif_meeting = Notification(
        recipient_id=u_infra_leader.id,
        project_id=proj_infra.id,
        message="🔔 Nhắc lịch họp: 'Họp Hạ tầng'\n⏰ Thời gian: 10:00 05/11/2026\n🔗 https://meet.google.com/test-meet",
        notification_type="meeting_reminder",
        is_read=False,
    )
    notif_infra_demo = Notification(
        recipient_id=u_infra_leader.id,
        project_id=proj_infra.id,
        message="✅ Task [INF-1] Done - có thể demo",
        notification_type="zalo_demo_ready",
        is_read=False,
    )
    notif_markee_demo = Notification(
        recipient_id=u_infra_leader.id,
        project_id=proj_markee.id,
        message="✅ Task [MK-1] Done - Markee App có thể demo",
        notification_type="zalo_demo_ready",
        is_read=False,
    )
    db.add_all([notif_meeting, notif_infra_demo, notif_markee_demo])
    db.commit()

    # Query inbox for infras workspace
    res = get_inbox_notifications(workspace="infras", db=db, current_user=u_infra_leader)

    items = res["items"]
    types = [item["notification_type"] for item in items]
    project_names = [item["project_name"] for item in items]

    assert "Markee App" not in project_names, "Cross-workspace Markee notification must be filtered out"
    assert "Infra Project" in project_names
    assert "meeting_reminder" in types, "Meeting reminder must be returned"
    assert "zalo_demo_ready" in types, "Infra demo must be returned"
    assert res["unread_count"] == 2
