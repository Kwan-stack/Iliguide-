import { authenticatedUser, clients, json, preflight } from '../_shared/http.ts';
import { escapeHtml, sendTemplate } from '../_shared/email.ts';

Deno.serve(async (req) => {
  const options = preflight(req);
  if (options) return options;
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const { admin, user } = clients(req);
    const actor = await authenticatedUser(req, user);
    if (!actor) return json({ error: 'Sign in before inviting staff' }, 401);
    const { data: actorProfile, error: actorError } = await admin
      .from('profiles').select('role, account_status').eq('id', actor.id).maybeSingle();
    if (actorError || !actorProfile || actorProfile.account_status !== 'active') {
      return json({ error: 'Active staff access is required' }, 403);
    }

    const body = await req.json();
    const email = String(body.email ?? '').trim().toLowerCase();
    const staffRole = String(body.staff_role ?? '');
    const siteId = body.site_id ? String(body.site_id) : null;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'Enter a valid email address' }, 400);
    if (!['gatekeeper', 'site_admin', 'tourism_office'].includes(staffRole)) {
      return json({ error: 'Visitor is the only role available through public registration' }, 400);
    }

    if (actorProfile.role === 'site_admin') {
      if (staffRole !== 'gatekeeper' || !siteId) return json({ error: 'Site administrators may invite gatekeepers only' }, 403);
      const { data: assignment } = await admin.from('staff_assignments')
        .select('id').eq('profile_id', actor.id).eq('site_id', siteId)
        .eq('staff_role', 'site_admin').eq('is_active', true).maybeSingle();
      if (!assignment) return json({ error: 'You cannot manage staff for that site' }, 403);
    } else if (actorProfile.role !== 'tourism_office') {
      return json({ error: 'Tourism Office access is required to provision this role' }, 403);
    }
    if ((staffRole === 'tourism_office' && siteId) || (staffRole !== 'tourism_office' && !siteId)) {
      return json({ error: 'Choose a site for site staff' }, 400);
    }

    const { data: existingProfile } = await admin.from('profiles')
      .select('id, role, account_status').eq('email', email).maybeSingle();
    if (existingProfile && existingProfile.role !== 'visitor' && existingProfile.role !== staffRole) {
      return json({ error: 'That account already has a different staff role' }, 409);
    }
    if (existingProfile && existingProfile.account_status !== 'active') {
      return json({ error: 'That account is not active' }, 409);
    }

    const { data: invitation, error: inviteRowError } = await admin.from('staff_invitations')
      .insert({
        email,
        staff_role: staffRole,
        site_id: siteId,
        invited_by: actor.id,
      })
      .select('id, email, staff_role, site_id, expires_at')
      .single();
    if (inviteRowError) return json({ error: 'An active invitation may already exist for this email' }, 409);

    if (existingProfile) {
      const wasVisitor = existingProfile.role === 'visitor';
      if (wasVisitor) {
        const { error: profileUpdateError } = await admin.from('profiles')
          .update({ role: staffRole }).eq('id', existingProfile.id);
        if (profileUpdateError) {
          await admin.from('staff_invitations').update({ status: 'revoked' }).eq('id', invitation.id);
          return json({ error: 'Could not update the existing visitor role' }, 500);
        }
      }
      if (siteId) {
        const { error: assignmentError } = await admin.from('staff_assignments').upsert({
          profile_id: existingProfile.id,
          site_id: siteId,
          staff_role: staffRole,
          assigned_by: actor.id,
          is_active: true,
        }, { onConflict: 'profile_id,site_id' });
        if (assignmentError) {
          await admin.from('staff_invitations').update({ status: 'revoked' }).eq('id', invitation.id);
          return json({ error: 'Could not assign the existing account to this site' }, 500);
        }
      }
      if (!wasVisitor) {
        const { error: acceptedError } = await admin.from('staff_invitations').update({
          status: 'accepted',
          accepted_profile_id: existingProfile.id,
        }).eq('id', invitation.id);
        if (acceptedError) return json({ error: 'Access was assigned, but the invitation record could not be updated' }, 503);
        return json({ invitation, existing_account: true });
      }
      const { data: assignedSite } = siteId
        ? await admin.from('tourism_sites').select('name').eq('id', siteId).maybeSingle()
        : { data: null };
      try {
        await sendTemplate(email, 6, {
          name: escapeHtml(email),
          role: escapeHtml(staffRole.replaceAll('_', ' ')),
          site_suffix: escapeHtml(assignedSite?.name ? ` for ${assignedSite.name}` : ''),
        });
      } catch (sendError) {
        console.error('staff access email', sendError instanceof Error ? sendError.message : sendError);
        if (wasVisitor) await admin.from('profiles').update({ role: 'visitor' }).eq('id', existingProfile.id);
        if (siteId) await admin.from('staff_assignments').update({ is_active: false })
          .eq('profile_id', existingProfile.id).eq('site_id', siteId);
        await admin.from('staff_invitations').update({ status: 'revoked' }).eq('id', invitation.id);
        return json({ error: 'Could not deliver the Iliguide staff access email' }, 502);
      }
      const { error: acceptedError } = await admin.from('staff_invitations').update({
        status: 'accepted',
        accepted_profile_id: existingProfile.id,
      }).eq('id', invitation.id);
      if (acceptedError) return json({ error: 'Access was assigned and emailed, but the invitation record could not be updated' }, 503);
      return json({ invitation, existing_account: true });
    }

    const appBaseUrl = Deno.env.get('APP_BASE_URL');
    const inviteOptions = appBaseUrl ? { redirectTo: new URL('/staff/login', appBaseUrl).toString() } : undefined;
    const { data: invited, error: authInviteError } = await admin.auth.admin.generateLink({
      type: 'invite', email, options: inviteOptions,
    });
    if (authInviteError || !invited.user || !invited.properties?.action_link) {
      await admin.from('staff_invitations').update({ status: 'revoked' }).eq('id', invitation.id);
      return json({ error: 'Could not create a secure invitation link' }, 502);
    }
    const invitedProfileId = invited.user?.id;
    const { data: invitedSite } = siteId
      ? await admin.from('tourism_sites').select('name').eq('id', siteId).maybeSingle()
      : { data: null };
    const { error: roleError } = await admin.from('profiles')
      .update({ role: staffRole, account_status: 'active' }).eq('id', invitedProfileId);
    if (roleError) {
      console.error('invited profile provisioning error', roleError.message);
      await admin.from('staff_invitations').update({ status: 'revoked' }).eq('id', invitation.id);
      await admin.auth.admin.deleteUser(invitedProfileId);
      return json({ error: 'Could not assign the staff account role' }, 503);
    }
    if (siteId) {
      const { error: assignmentError } = await admin.from('staff_assignments').upsert({
        profile_id: invitedProfileId,
        site_id: siteId,
        staff_role: staffRole,
        assigned_by: actor.id,
        is_active: true,
      }, { onConflict: 'profile_id,site_id' });
      if (assignmentError) {
        console.error('invited assignment provisioning error', assignmentError.message);
        await admin.from('staff_invitations').update({ status: 'revoked' }).eq('id', invitation.id);
        await admin.auth.admin.deleteUser(invitedProfileId);
        return json({ error: 'Could not create the site assignment' }, 503);
      }
    }
    try {
      await sendTemplate(email, 5, {
        role: escapeHtml(staffRole.replaceAll('_', ' ')),
        site_suffix: escapeHtml(invitedSite?.name ? ` for ${invitedSite.name}` : ''),
        email: escapeHtml(email),
        url: escapeHtml(invited.properties.action_link),
      });
    } catch (sendError) {
      console.error('staff invite email', sendError instanceof Error ? sendError.message : sendError);
      await admin.from('staff_invitations').update({ status: 'revoked' }).eq('id', invitation.id);
      await admin.auth.admin.deleteUser(invitedProfileId);
      return json({ error: 'Could not deliver the Iliguide staff invitation' }, 502);
    }
    return json({ invitation, existing_account: false });
  } catch (error) {
    console.error('invite-staff', error);
    return json({ error: 'Could not invite staff' }, 500);
  }
});
