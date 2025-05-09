const $modal = $('#post-modal');
const $modalContent = $('#modal-content');
const $textarea = $('#post');
const $addPostBtn = $('#add-post-btn');
const $body = $('body');
const $closeModal = $('#close-modal');

$addPostBtn.click(openModal);

$closeModal.click(closeModal);

$(window).click(function (e) {
    if (e.target === $modal[0]) closeModal();
});

$(document).keydown(function (e) {
    if (e.key === 'Escape') closeModal();
});

function openModal() {
    $modal.show();
    $textarea.focus();
    $body.css('overflow', 'hidden');
}

function closeModal() {
    $modal.hide();
    $body.css('overflow', 'auto');
    $textarea.val('');
}

// $(document).ready(function () {
//     const contentSection = $('#content-section');
//     const loadingIndicator = $('#loading-indicator');

//     contentSection.on('scroll', function () {
//         if (contentSection.scrollTop() + contentSection.innerHeight() >= contentSection[0].scrollHeight - 10) {
//             loadMorePosts();
//         }
//     });

//     function loadMorePosts() {
//         const currentPage = parseInt(contentSection.data('page'), 10);
//         loadingIndicator.show();

//         $.ajax({
//             url: `/load-posts?page=${currentPage + 1}`,
//             method: 'GET',
//             success: function (data) {
//                 if (data.posts && data.posts.length > 0) {
//                     data.posts.forEach(post => {
//                         contentSection.append(`<article class="section__content"><p>${post.value}</p></article>`);
//                     });
//                     contentSection.data('page', currentPage + 1);
//                 }
//                 loadingIndicator.hide();
//             },
//             error: function () {
//                 console.error('Failed to load more posts.');
//                 loadingIndicator.hide();
//             }
//         });
//     }
// });