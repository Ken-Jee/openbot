// The text of the terms and conditions. Legal wording: change it only from the approved source text,
// and move `TERMS_UPDATED_AT` with it.

import { Link } from "@tanstack/solid-router";

const CONTACT_EMAIL = "hello@openbot.run";

export function Terms() {
  return (
    <>
      <p>Please read the Terms &amp; Conditions carefully before you start to use the Platform.</p>

      <h2>Acceptance of the Terms &amp; Conditions</h2>
      <p>
        These Terms &amp; Conditions ("Terms") govern the use of OpenBot and form a legally binding agreement between
        you and OpenBot. By accessing or using the Services, you agree to these Terms. If you are acting on behalf of an
        organization, you represent that you have the authority to accept these Terms on its behalf.
      </p>

      <h2>Accounts and Eligibility</h2>
      <p>
        To access or use the Platform, you must be at least 18 years old and have the legal capacity to enter into a
        binding agreement. By using the Platform, you represent that you meet these requirements.
      </p>
      <p>
        You are responsible for maintaining the confidentiality and security of your account credentials and for all
        activities conducted through your account. You agree to notify OpenBot without undue delay if you become aware
        of any unauthorised access to or use of your account or any other security incident affecting your account.
      </p>

      <h2>Services Description</h2>
      <p>
        OpenBot is a source-available platform that enables users to create, configure, manage, and collaborate with
        artificial intelligence agents ("AI Agents").
      </p>
      <p>Depending on the selected functionality, users can:</p>
      <ul>
        <li>create and customise AI Agents for specific tasks and workflows;</li>
        <li>organise AI Agents into teams and shared working environments;</li>
        <li>assign tasks, manage queues, and schedule recurring activities;</li>
        <li>enable communication and collaboration between AI Agents;</li>
        <li>connect external AI providers, applications, tools, and services;</li>
        <li>manage agent workspaces, files, and generated outputs;</li>
        <li>access supported browser automation and computer interaction features;</li>
        <li>discover, install, and share agents, plugins, and skills through the Marketplace;</li>
        <li>collaborate with other authorised users; and</li>
        <li>operate OpenBot on their own devices or servers or through optional hosted server services.</li>
      </ul>
      <p>
        OpenBot acts as a software environment for accessing and coordinating AI technologies. It does not independently
        provide the underlying AI models used by third-party providers.
      </p>
      <p>
        The availability of individual features may depend on the user's device, operating system, selected AI provider,
        connected services, account configuration, and subscription plan.
      </p>

      <h2>Conclusion and Duration of the Agreement</h2>
      <p>
        An agreement for the use of account-based Services is concluded when the User completes the applicable
        registration process and accepts these Terms.
      </p>
      <p>
        Certain functionalities may be available without creating an account. The use of downloaded OpenBot software is
        additionally subject to the licence applicable to the relevant software version.
      </p>
      <p>
        An agreement for paid Hosted Server Services is concluded upon confirmation of the subscription purchase through
        the applicable checkout process. The provision of the purchased Services begins following successful payment
        confirmation and activation of the relevant Hosted Server.
      </p>
      <p>
        Agreements for account-based Services remain in effect until terminated by the User or OpenBot in accordance
        with these Terms. Paid subscriptions remain in effect for the applicable billing periods and are subject to the
        renewal and cancellation conditions described in these Terms.
      </p>
      <p>
        Users may discontinue use of the Services at any time, subject to any outstanding contractual obligations and
        the conditions applicable to paid subscriptions.
      </p>

      <h2>Technical Requirements</h2>
      <p>
        Access to and use of the Platform requires a compatible device, an operating system supported by the relevant
        version of OpenBot, and any additional software or technical components necessary for the selected
        functionality.
      </p>
      <p>
        Certain features require an internet connection, an OpenBot account, or access to third-party AI providers and
        external services. The technical requirements and compatibility of individual applications and functionalities
        may vary depending on the operating environment and the version of the software used.
      </p>
      <p>
        Users are responsible for ensuring that their devices, operating systems, network connections, and independently
        managed infrastructure meet the applicable technical requirements. Users are also responsible for maintaining
        the software and services necessary to use their selected integrations.
      </p>
      <p>
        Information regarding supported operating systems, installation procedures, and relevant technical requirements
        is available through the official OpenBot website and documentation.
      </p>

      <h2>Acceptable Use and Prohibited Activities</h2>
      <p>
        You agree to use the Platform and the Services in accordance with applicable laws, these Terms, and the rights
        of other users and third parties.
      </p>
      <p>You must not use the Platform, AI Agents, integrations, or other functionalities to:</p>
      <ul>
        <li>engage in unlawful, fraudulent, deceptive, or otherwise prohibited activities;</li>
        <li>
          infringe intellectual property rights, confidentiality obligations, privacy rights, or other legally protected
          interests;
        </li>
        <li>
          access or attempt to access accounts, systems, networks, files, or information without appropriate
          authorisation;
        </li>
        <li>introduce, distribute, or execute malware, malicious code, or other harmful software;</li>
        <li>
          interfere with the security, integrity, availability, or proper functioning of the Platform or connected
          systems;
        </li>
        <li>
          circumvent authentication mechanisms, access controls, or other technical restrictions without authorisation;
        </li>
        <li>impersonate another person or organisation or misrepresent your authority to act on their behalf;</li>
        <li>publish, transmit, or otherwise make available unlawful content; or</li>
        <li>
          instruct or authorise AI Agents to perform activities that would be unlawful if carried out directly by the
          user.
        </li>
      </ul>
      <p>
        You are responsible for ensuring that activities performed through the Platform, including automated tasks and
        interactions with external systems, remain within the scope of your legal rights and authorisations.
      </p>
      <p>
        OpenBot may take appropriate and proportionate measures in response to violations of these Terms, subject to
        applicable law.
      </p>

      <h2>Software Licence and Intellectual Property</h2>
      <p>
        OpenBot is a source-available software platform. The source code is made available under the licence applicable
        to the relevant software version.
      </p>
      <p>
        Users must comply with the conditions of the applicable software licence. Access to the Platform or purchase of
        additional Services does not automatically grant rights beyond those provided under that licence.
      </p>
      <p>
        The terms governing any separately licensed commercial use are determined by the applicable licensing agreement.
      </p>
      <p>The relevant licence is available through the official OpenBot source code repository.</p>
      <p>
        The OpenBot name, logos, trademarks, website content, documentation, and other proprietary materials remain the
        property of their respective rights holders and are protected by applicable intellectual property laws.
      </p>
      <p>
        Except where expressly permitted by the applicable licence, these Terms, or mandatory law, users are not granted
        any rights to use OpenBot's trademarks, branding, or other proprietary materials.
      </p>
      <p>
        These Terms govern the contractual use of the Services and do not replace or override the software licence
        applicable to a particular version of OpenBot.
      </p>

      <h2>User Content and Intellectual Property Rights</h2>
      <p>
        Users may create, upload, import, submit, or otherwise make available documents, files, instructions, source
        code, agent configurations, and other materials through the Platform.
      </p>
      <p>Users retain their rights to User Content to the extent that such rights exist under applicable law.</p>
      <p>
        By providing User Content, you represent that you hold the necessary rights or authorisations to use that
        content and to make it available through the functionalities you choose to enable.
      </p>
      <p>
        You are responsible for ensuring that User Content does not infringe the rights of third parties or violate
        applicable laws.
      </p>
      <p>
        Where you choose to publish or share User Content through OpenBot's public sharing functionalities, you grant
        OpenBot a non-exclusive, worldwide, royalty-free licence to host, reproduce, display, distribute, and
        technically adapt that content solely to the extent necessary to provide the relevant publication or sharing
        functionality.
      </p>
      <p>
        This licence does not transfer ownership of User Content to OpenBot. It applies for the period during which the
        relevant content is made available through the Services, together with any additional period reasonably
        necessary to complete its removal, subject to applicable law.
      </p>
      <p>
        OpenBot does not acquire ownership of User Content solely because it is created, stored, or processed using the
        Platform.
      </p>

      <h2>AI-Generated Outputs</h2>
      <p>
        AI Agents may generate text, documents, source code, recommendations, analyses, images, or other outputs using
        the AI providers and configurations selected by users.
      </p>
      <p>
        The availability and scope of rights in AI Outputs depend on applicable intellectual property laws and, where
        relevant, the terms of the selected AI provider.
      </p>
      <p>
        OpenBot does not independently guarantee that AI Outputs qualify for intellectual property protection, are
        original, or do not resemble content generated for other users.
      </p>
      <p>
        Users are responsible for reviewing AI Outputs and ensuring that their intended use complies with applicable
        laws and third-party rights.
      </p>

      <h2>AI Agents and Automated Activities</h2>
      <p>
        OpenBot enables users to create and configure AI Agents capable of carrying out tasks, executing instructions,
        interacting with applications, and performing automated activities.
      </p>
      <p>
        Depending on the enabled functionalities, operating environment, and permissions available to the application,
        AI Agents may access and modify files, execute commands, interact with websites and external applications, use
        connected services, and communicate with other AI Agents.
      </p>
      <p>
        Certain automated activities may be performed without requiring separate user confirmation before each
        individual action.
      </p>
      <p>
        You acknowledge that actions performed by AI Agents may affect your files, applications, connected accounts,
        systems, and other resources accessible to the relevant agent.
      </p>
      <p>You are responsible for:</p>
      <ul>
        <li>selecting and configuring AI Agents according to their intended purpose;</li>
        <li>defining appropriate instructions, permissions, and access restrictions;</li>
        <li>ensuring that AI Agents operate only within the scope of your authority;</li>
        <li>reviewing automated activities and their results where appropriate; and</li>
        <li>
          implementing suitable precautions, including backups and restrictions on access to sensitive or important
          resources.
        </li>
      </ul>
      <p>
        Users should exercise particular care when enabling functionalities that allow AI Agents to modify or delete
        information, execute commands, interact with external systems, or perform actions with legal, financial, or
        operational consequences.
      </p>
      <p>
        AI Agents operate using artificial intelligence technologies and may produce inaccurate, incomplete, unexpected,
        or otherwise unsuitable results.
      </p>
      <p>
        OpenBot does not guarantee that AI Agents will correctly interpret every instruction, successfully complete
        every task, or produce results suitable for a particular purpose.
      </p>
      <p>You should independently verify important AI Outputs and decisions before relying on them.</p>
      <p>
        AI-generated information does not constitute professional advice merely because it is produced through the
        Platform. Where appropriate, users should obtain advice from a qualified professional.
      </p>
      <p>
        Nothing in this section excludes any responsibility that OpenBot is required to assume under applicable law.
      </p>

      <h2>Third-Party AI Providers and Integrations</h2>
      <p>
        OpenBot allows users to connect AI providers, external applications, APIs, tools, and other services of their
        choice.
      </p>
      <p>Certain integrations may require separate accounts, subscriptions, API keys, credentials, or permissions.</p>
      <p>
        Users are responsible for obtaining and maintaining the authorisations necessary to use their selected
        third-party services.
      </p>
      <p>
        When connecting an external service, you agree to comply with its applicable terms and conditions, licensing
        requirements, and acceptable use rules.
      </p>
      <p>
        The availability, pricing, functionality, and technical requirements of third-party services are determined by
        their respective providers.
      </p>
      <p>
        Fees charged by external AI providers or connected services are separate from fees payable to OpenBot, unless
        expressly stated otherwise.
      </p>
      <p>
        OpenBot does not control the independent operation, commercial conditions, or availability of third-party
        services.
      </p>
      <p>
        OpenBot shall not be responsible for failures, interruptions, restrictions, or changes attributable exclusively
        to independently selected third-party services, except to the extent that such responsibility arises under
        applicable law.
      </p>

      <h2>Teams and Shared Environments</h2>
      <p>OpenBot enables users to collaborate within shared environments and to organise AI Agents into teams.</p>
      <p>
        Depending on the relevant configuration, authorised users may be able to access shared workspaces, manage
        agents, assign tasks, exchange information, and interact with resources made available to the team.
      </p>
      <p>
        Team owners and administrators are responsible for managing invitations, memberships, permissions, and access to
        their shared environments.
      </p>
      <p>
        Users must ensure that they have the necessary authority to invite other individuals, share resources, and grant
        access to information or connected services.
      </p>
      <p>
        Each user is responsible for activities performed using their own account and for complying with the permissions
        applicable to the relevant shared environment.
      </p>
      <p>
        Users must not attempt to access shared environments, information, or resources beyond the permissions granted
        to them.
      </p>

      <h2>Marketplace and Shared Materials</h2>
      <p>
        The OpenBot Marketplace allows users to discover, install, and, where supported, publish or share AI Agents,
        plugins, skills, and related configurations.
      </p>
      <p>Marketplace materials may be provided by OpenBot or by independent contributors.</p>
      <p>
        Users are responsible for reviewing the description, instructions, included functionalities, and relevant
        permissions of Marketplace materials before installing or enabling them.
      </p>
      <p>
        Certain Marketplace items may contain instructions, routines, or integrations that enable AI Agents to perform
        automated activities.
      </p>
      <p>
        The installation of a Marketplace item does not guarantee that it will be suitable, compatible, secure, or
        reliable for a particular purpose.
      </p>

      <h3>Publishing Materials</h3>
      <p>
        Users who submit or publish Marketplace materials represent that they hold the necessary rights to make those
        materials available and that their publication does not infringe applicable laws or third-party rights.
      </p>
      <p>
        Before submitting materials, users are responsible for ensuring that the submission does not contain
        confidential information, credentials, or other content that they are not authorised to publish.
      </p>
      <p>
        Materials submitted for publication may be subject to review. Submission does not guarantee approval or
        publication.
      </p>
      <p>
        OpenBot may reject, restrict, or remove materials that violate these Terms, infringe third-party rights, or are
        unlawful, subject to applicable legal requirements.
      </p>
      <p>
        Where required by applicable law, affected users will be informed of the reasons for restrictions imposed on
        their content and of the available means of redress.
      </p>

      <h3>Reporting Unlawful Content</h3>
      <p>
        Users and third parties may report potentially unlawful publicly shared materials using the applicable reporting
        or contact mechanisms made available by OpenBot.
      </p>
      <p>Reports should identify the content concerned and explain the reasons why it is considered unlawful.</p>
      <p>
        Where the Digital Services Act applies to the relevant functionality, OpenBot will comply with the applicable
        requirements concerning reporting mechanisms, content-related decisions, notifications, and available remedies.
      </p>

      <h2>Local Use, Self-Hosting and Hosted Servers</h2>
      <p>
        OpenBot can operate on users' own devices, independently managed servers, or optional server environments
        provided by OpenBot.
      </p>

      <h3>Local and Self-Hosted Environments</h3>
      <p>
        Where users operate OpenBot on their own devices or infrastructure, they are responsible for ensuring that the
        relevant environment is appropriately configured and maintained.
      </p>
      <p>
        This includes maintaining compatible hardware, software, network connectivity, access permissions, and other
        technical resources necessary for the intended use.
      </p>
      <p>
        The availability and performance of independently managed environments depend on the user's infrastructure and
        configuration.
      </p>

      <h3>OpenBot Hosted Servers</h3>
      <p>
        OpenBot offers optional hosted server services that provide an environment in which users may operate AI Agents
        and collaborate with authorised team members.
      </p>
      <p>
        Hosted server plans may differ in processing resources, storage capacity, permitted team size, and other
        technical characteristics.
      </p>
      <p>
        The features and limits applicable to a particular plan are described in the relevant service information and
        purchasing interface.
      </p>
      <p>
        Hosted server subscriptions cover the provision of the server environment. They do not include access to
        third-party AI models or subscriptions unless expressly stated otherwise.
      </p>
      <p>
        Hosted servers may automatically stop after a period of inactivity and restart when activated through supported
        functionality. This may result in a delay before the relevant environment becomes available again.
      </p>
      <p>
        Users are responsible for managing the content and activities within their hosted environments and for
        maintaining appropriate copies of important information.
      </p>
      <p>
        Deleting a hosted server removes the associated server environment and its contents, subject to any technical or
        legal limitations described in the <Link to="/privacy-policy">Privacy Policy</Link>.
      </p>
      <p>
        Where OpenBot provides individually agreed hosting arrangements or other business services, additional
        contractual terms may apply.
      </p>

      <h2>Fees, Subscriptions and Payments</h2>
      <p>
        Certain functionalities of OpenBot are available without payment to OpenBot, subject to the applicable software
        licence and any charges imposed by independently selected third-party providers.
      </p>
      <p>Optional Services, including hosted servers, may be offered on a paid subscription basis.</p>
      <p>
        The applicable fees, billing periods, plan characteristics, and relevant contractual conditions are presented to
        users before purchase.
      </p>
      <p>Paid subscriptions may be available on monthly or annual billing plans.</p>
      <p>
        By purchasing a paid Service, you agree to pay the applicable fees under the conditions presented during the
        purchasing process.
      </p>
      <p>Payments for paid Services are processed through Stripe.</p>
      <p>
        Where a subscription is subject to automatic renewal, this information, including the applicable renewal period
        and recurring charges, must be presented before the user completes the purchase.
      </p>
      <p>
        Unless the subscription is cancelled before the applicable renewal date, recurring charges may continue in
        accordance with the subscription conditions accepted by the user.
      </p>
      <p>
        Users may manage their subscriptions through the available billing and subscription management functionality.
      </p>
      <p>
        Changes to a subscription plan may affect the applicable fees, billing period, available features, or technical
        resources. Any resulting charges or adjustments are governed by the conditions presented in connection with the
        relevant change.
      </p>
      <p>
        Where payment is not completed, access to the corresponding paid Service may be restricted in accordance with
        the applicable contractual conditions and law.
      </p>
      <p>
        Any changes to recurring subscription fees will be subject to applicable contractual and legal requirements,
        including advance notice where required.
      </p>

      <h3>Subscription Cancellation</h3>
      <p>
        Hosted Server subscriptions automatically renew for successive billing periods, either monthly or annually,
        until cancelled by the User. The fee for each subsequent period is charged at the beginning of that period, in
        accordance with the selected subscription plan.
      </p>
      <p>
        Users may cancel their subscriptions at any time through the subscription management settings. Cancellation
        disables automatic renewal, and the User retains access to the Hosted Server until the end of the paid billing
        period. Once the subscription has been successfully cancelled, no further charges will be made for subsequent
        billing periods.
      </p>
      <p>
        If a payment for subscription renewal fails, access to the Hosted Server may be restricted after the end of the
        paid billing period. The User will be informed of the payment issue and the available options for resolving it.
      </p>
      <p>
        In the event of a change to subscription prices, OpenBot will inform the User sufficiently in advance of the
        next billing period, allowing the User to accept the new pricing terms or cancel the subscription. Any price
        change will not affect a subscription period that has already been paid for. If the User does not accept the new
        price, the subscription will terminate at the end of the paid billing period.
      </p>
      <p>
        In the event of an incorrectly charged fee, the User may submit a refund request using the contact details
        provided in these Terms, including the email address associated with their account, the payment date, and a
        brief description of the issue. OpenBot will respond to the request within 14 days of receipt.
      </p>

      <h3>Hosted Server Subscription Termination</h3>
      <p>
        Cancellation of automatic renewal does not, by itself, constitute a request to delete the Hosted Server or its
        stored content.
      </p>
      <p>
        Users may manage their Hosted Servers through the available billing functionality, including options to cancel
        renewal, retain server data, delete a server immediately, or schedule its deletion at the end of the paid
        billing period.
      </p>
      <p>
        When a paid subscription expires, the Hosted Server ceases to operate under that subscription. Where the User
        has not requested deletion, the expiry of the subscription does not itself constitute an instruction to delete
        the associated workspace data.
      </p>
      <p>Users may renew or reactivate an eligible subscription through the available billing functionality.</p>
      <p>
        Where a User chooses to delete a Hosted Server, the associated server environment and its contents, including
        agent workspaces, conversations, files, and related materials, are removed in accordance with the applicable
        functionality.
      </p>
      <p>
        Users are responsible for saving or exporting any content they wish to retain before deleting a Hosted Server.
      </p>
      <p>
        The termination of a Hosted Server subscription does not automatically terminate the User's OpenBot account or
        any separate agreements with third-party service providers.
      </p>

      <h2>Consumer Right of Withdrawal</h2>
      <p>
        Payments are non-refundable unless otherwise required by applicable law. Nothing in these Terms overrides any
        applicable local laws concerning your right to cancel a subscription. If you reside in the European Union, the
        United Kingdom, or Turkey and cancel your subscription within 14 days of purchase, you are entitled to a
        proportional refund.
      </p>

      <h2>Complaints and Consumer Rights</h2>
      <p>
        Users may submit complaints concerning the operation of the Platform, the provision of Services, or the
        performance of contractual obligations using the contact details provided in these Terms.
      </p>
      <p>
        A complaint should, where possible, include information sufficient to identify the relevant Service or account,
        a description of the issue, and the remedy requested.
      </p>
      <p>OpenBot will review complaints and provide a response in accordance with applicable law.</p>
      <p>
        Complaints submitted by consumers will be answered within 14 days of receipt, unless a different period is
        prescribed by applicable law.
      </p>
      <p>The response to the complaint will be sent to the user by email.</p>
      <p>
        Consumers are entitled to the statutory remedies available under applicable law, including those relating to the
        conformity of digital content and digital services with the contract.
      </p>
      <p>
        Depending on the circumstances and applicable legal requirements, these remedies may include bringing the
        Service into conformity with the contract, a price reduction, or termination of the contract.
      </p>
      <p>Nothing in these Terms excludes or restricts mandatory consumer rights.</p>

      <h2>Suspension and Termination of Access</h2>
      <p>
        OpenBot may suspend, restrict, or terminate access to the Platform or particular Services where reasonably
        necessary in connection with:
      </p>
      <ul>
        <li>serious or repeated violations of these Terms;</li>
        <li>unlawful activities or unauthorised use of the Services;</li>
        <li>threats to the security or integrity of the Platform or connected infrastructure;</li>
        <li>
          failure to fulfil payment obligations relating to paid Services, in accordance with the applicable contractual
          conditions; or
        </li>
        <li>compliance with applicable legal obligations or binding decisions of competent authorities.</li>
      </ul>
      <p>Any measures taken will be appropriate and proportionate to the circumstances, subject to applicable law.</p>
      <p>
        Where required by law, OpenBot will provide the affected user with information about the reasons for the
        restriction and any available remedies.
      </p>
      <p>
        Users may discontinue use of the Platform at any time and may request account deletion in accordance with the
        applicable procedures.
      </p>
      <p>
        Termination of access to the Platform does not automatically terminate separate agreements entered into with
        third-party AI providers or external services.
      </p>
      <p>
        Termination does not affect rights and obligations accrued before its effective date, including outstanding
        payment obligations, intellectual property rights, and provisions that by their nature remain applicable after
        termination.
      </p>

      <h2>Service Availability and Limitations of Liability</h2>
      <p>
        OpenBot aims to provide functional and reliable Services. However, the availability and performance of the
        Platform may depend on technical conditions, software configurations, network connectivity, third-party
        services, and other factors.
      </p>
      <p>
        OpenBot does not guarantee that every functionality will operate without interruption or that AI Agents will
        successfully complete every requested task.
      </p>
      <p>
        AI-generated outputs and automated activities may contain errors or produce unintended results. Users should
        exercise appropriate care when relying on such outputs or authorising actions that may affect important
        information or resources.
      </p>
      <p>
        Where the Platform relies on independently selected third-party AI providers or external services, their
        performance and availability remain subject to the conditions governing those services.
      </p>
      <p>
        OpenBot's liability for the performance of its own contractual obligations is determined in accordance with
        applicable law.
      </p>
      <p>
        To the extent permitted by applicable law, OpenBot is not responsible for losses resulting exclusively from
        unlawful or unauthorised user instructions, independently managed infrastructure, or circumstances attributable
        solely to external services outside OpenBot's reasonable control.
      </p>
      <p>Nothing in these Terms excludes or limits liability that cannot lawfully be excluded or restricted.</p>
      <p>
        In particular, these Terms do not affect mandatory consumer rights, statutory remedies, or liability arising
        from intentional misconduct.
      </p>

      <h2>Privacy and Data Protection</h2>
      <p>
        Personal data processed in connection with the Services is handled in accordance with the{" "}
        <Link to="/privacy-policy">OpenBot Privacy Policy</Link>, available through the official OpenBot website.
      </p>
      <p>
        Where required, the processing of personal data on behalf of a customer is additionally governed by a separate
        Data Processing Agreement.
      </p>
      <p>
        These Terms regulate the contractual use of the Platform, while the Privacy Policy provides information about
        the processing of personal data.
      </p>

      <h2>Export and Sanctions</h2>
      <p>
        Users must comply with all applicable export control, trade, customs, anti-boycott, and economic sanctions laws
        and regulations when accessing or using the Platform and the Services.
      </p>
      <p>
        Users represent that they are not located in, ordinarily resident in, organized under the laws of, or acting on
        behalf of any country, territory, entity, or person subject to sanctions, embargoes, or trade restrictions
        imposed under applicable laws, including the European Union, the United Nations, the United Kingdom, and, where
        applicable, the United States, if such sanctions or restrictions prohibit or restrict access to or use of the
        Platform or the Services.
      </p>
      <p>
        Users must not access, use, export, re-export, transfer, make available, or otherwise deal with the Platform,
        the Services, or any related technology in violation of any applicable export control, sanctions, or trade
        compliance laws.
      </p>
      <p>
        OpenBot may suspend, restrict, or terminate access to the Platform or the Services where it reasonably believes
        that continued access or use may violate applicable export control, sanctions, or trade compliance laws.
      </p>

      <h2>Governing Law</h2>
      <p>
        THESE TERMS SHALL BE GOVERNED BY AND CONSTRUED IN ACCORDANCE WITH THE LAWS OF POLAND, EXCLUDING ITS CONFLICT OF
        LAWS RULES.
      </p>
      <p>
        IF YOU ARE ACTING IN THE COURSE OF A BUSINESS OR PROFESSIONAL ACTIVITY, ANY DISPUTE ARISING OUT OF OR IN
        CONNECTION WITH THESE TERMS, THE PLATFORM, OR THE SERVICES SHALL BE SUBJECT TO THE EXCLUSIVE JURISDICTION OF THE
        COMPETENT COURTS OF POLAND.
      </p>
      <p>
        IF YOU ARE A CONSUMER, NOTHING IN THESE TERMS LIMITS OR EXCLUDES ANY MANDATORY RIGHTS OR PROTECTIONS AVAILABLE
        TO YOU UNDER APPLICABLE CONSUMER PROTECTION LAWS. ANY DISPUTE INVOLVING A CONSUMER SHALL BE RESOLVED BY THE
        COURTS HAVING JURISDICTION UNDER APPLICABLE LAW.
      </p>

      <h2>Changes to the Services or Terms</h2>
      <p>
        We reserve the right to modify, enhance, suspend, or discontinue any aspect of the services at any time in order
        to improve their functionality, security, performance, or compliance with applicable laws and business
        requirements. We may also revise these Terms from time to time to reflect changes in our services, legal
        obligations, or operational practices. Where required by applicable law or where the changes materially affect
        your rights or obligations, we will provide reasonable notice through the Platform, by email, or by any other
        appropriate means before such changes become effective. Unless otherwise stated, the revised Terms will take
        effect on the date specified in the notice. By continuing to access or use the Platform after the revised Terms
        become effective, you acknowledge that you have read and accepted the updated Terms. If you do not agree with
        the revised Terms, you must discontinue your use of the Platform before the effective date of the changes, where
        applicable.
      </p>

      <h2>Miscellaneous</h2>
      <p>
        These Terms constitute the entire agreement between you and OpenBot regarding your access to and use of the
        Platform. They govern all matters relating to the Platform and supersede all prior and contemporaneous
        agreements, understandings, representations, warranties, and communications, whether oral or written, concerning
        the same subject matter. If any provision of these Terms is held to be invalid, illegal, or unenforceable, the
        remaining provisions shall continue in full force and effect.
      </p>
      <p>
        You may not transfer your account or your rights under these Terms to another person without OpenBot's prior
        written consent. OpenBot may transfer its rights and obligations under these Terms in connection with a merger,
        acquisition, reorganisation, or other corporate transaction, provided that such transfer does not adversely
        affect your rights under these Terms. No waiver of any provision of these Terms shall be effective unless made
        in writing. A failure or delay by either party to exercise any right under these Terms shall not constitute a
        waiver of that right.
      </p>

      <h2>Your Comments and Concerns</h2>
      <p>The Platform is operated by OpenBot:</p>
      <p>
        Synthetify Labs sp. z o.o.
        <br />
        Trzebunia 513, 32-438 Trzebunia, Poland
      </p>
      <p>
        All inquiries, feedback, comments, requests for technical support, and other communications concerning the
        Platform should be addressed to: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
      </p>
    </>
  );
}
